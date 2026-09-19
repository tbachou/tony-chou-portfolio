import { readFileSync } from 'fs';
import { join } from 'path';

import { INJURY_AREAS } from '@portfolio/shared';

import {
  CLINICAL_RULES,
  everyRuleIdKnown,
  findClinicalRule,
} from './clinical-rules';

// The real prompt file, not a fixture and not the mocked skill loader. The
// whole point of this spec is that the registry and the prompt cannot drift,
// and a fixture would let them drift together.
const DRAFTER_MD = readFileSync(
  join(__dirname, 'skills', 'drafter.md'),
  'utf8',
);

// drafter.md's injury sections are `### <injuryArea>` headings; the general
// rules live in the sections before `## Injury-specific rules` and in
// `## Hard rules`. A rule's section is where its text must be, and the only
// place it may be.
const INJURY_HEADINGS = [
  '### finger_pulley',
  '### elbow_tendinopathy',
  '### shoulder_impingement',
] as const;

function sliceFrom(marker: string): string {
  const start = DRAFTER_MD.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const rest = DRAFTER_MD.slice(start + marker.length);
  const next = rest.search(/\n##+ /);
  return next === -1 ? rest : rest.slice(0, next);
}

function sectionFor(scope: string): string {
  if (scope === 'general') {
    let general = DRAFTER_MD;
    for (const heading of INJURY_HEADINGS) {
      general = general.replace(heading + sliceFrom(heading), '');
    }
    return general;
  }
  return sliceFrom(`### ${scope}`);
}

describe('clinical rule registry', () => {
  // This is the test that earns the file. drafter.md's maintainer note asks a
  // human to keep the transcribed rules in step; nothing enforced it. Now an
  // edit to either side fails here, naming the rule.
  //
  // A bare substring check was not enough: the 2026-09-19 break-it pass
  // showed a rule duplicated into another injury's section, moved under the
  // wrong heading, or given a trailing "except for..." all still passed. So
  // each rule must appear exactly once, inside its own section, and an
  // injury rule must be a whole bullet.
  describe('every rule is verbatim from drafter.md, once, in its own section', () => {
    const count = (haystack: string, needle: string) =>
      haystack.split(needle).length - 1;

    it.each(CLINICAL_RULES.map((rule) => [rule.id, rule]))(
      '%s appears exactly once, in its section',
      (_id, rule) => {
        const own = sectionFor(rule.scope);
        expect(count(own, rule.text)).toBe(1);
        expect(count(DRAFTER_MD, rule.text)).toBe(1);
        if (rule.scope !== 'general') {
          expect(own.split('\n')).toContain(`- ${rule.text}`);
        }
      },
    );
  });

  it('has unique ids', () => {
    const ids = CLINICAL_RULES.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('prefixes each id by the scope it belongs to', () => {
    const prefixes: Record<string, string> = {
      general: 'GEN',
      finger_pulley: 'FP',
      elbow_tendinopathy: 'ET',
      shoulder_impingement: 'SI',
    };
    for (const rule of CLINICAL_RULES) {
      expect(rule.id.startsWith(`${prefixes[rule.scope]}-`)).toBe(true);
    }
  });

  // A new injury area added to the shared enum without clinical rules would
  // otherwise ship a condition Beta plans for and cannot account for.
  it('covers every injury area the request schema accepts', () => {
    for (const area of INJURY_AREAS) {
      expect(CLINICAL_RULES.some((rule) => rule.scope === area)).toBe(true);
    }
  });

  // The invariant that has to survive grading: a source without a grade is
  // curation left half done, and a SORT grade without a source is the
  // overclaim this registry exists to prevent. `author-judgement` is the only
  // label allowed to stand on nothing, because it claims nothing.
  it('never carries a SORT grade without a source, or a source without one', () => {
    for (const rule of CLINICAL_RULES) {
      if (rule.evidence === 'author-judgement') {
        expect(rule.sources).toHaveLength(0);
      } else {
        expect(rule.sources.length).toBeGreaterThan(0);
      }
    }
  });

  // Every attached source carries a DOI, and every DOI has the registered
  // shape. A cheap floor against the failure this registry exists to prevent:
  // a citation with no identifier cannot be re-resolved by anyone, and a DOI
  // that does not even parse was never looked up.
  describe('every attached source is re-resolvable', () => {
    const attached = CLINICAL_RULES.flatMap((rule) =>
      rule.sources.map((source) => [rule.id, source] as const),
    );

    it.each(attached)('%s cites a DOI of the registered form', (_id, source) => {
      expect(source.doi).toMatch(/^10\.\d{4,9}\/\S+$/);
    });

    it.each(attached)('%s links to PubMed Central or PubMed', (_id, source) => {
      expect(source.url).toMatch(
        /^https:\/\/(pmc|pubmed)\.ncbi\.nlm\.nih\.gov\/(articles\/PMC\d+|\d+)\/$/,
      );
    });

    it.each(attached)('%s says what the source supports', (_id, source) => {
      expect(source.supports.length).toBeGreaterThan(40);
    });

    it('never cites the same DOI twice under one rule', () => {
      for (const rule of CLINICAL_RULES) {
        const dois = rule.sources.map((source) => source.doi);
        expect(new Set(dois).size).toBe(dois.length);
      }
    });
  });

  describe('findClinicalRule', () => {
    it('returns the rule for a known id', () => {
      expect(findClinicalRule('FP-05')?.scope).toBe('finger_pulley');
    });

    it('returns undefined for an unknown id', () => {
      expect(findClinicalRule('FP-999')).toBeUndefined();
    });
  });

  describe('everyRuleIdKnown', () => {
    it('accepts ids drawn from the registry', () => {
      expect(everyRuleIdKnown(['GEN-01', 'ET-04'])).toBe(true);
    });

    it('rejects a set containing one unknown id', () => {
      expect(everyRuleIdKnown(['GEN-01', 'INVENTED-01'])).toBe(false);
    });

    // A plausible model failure: citing an id that reads right and is not
    // real. Set membership catches it; a substring or similarity check on the
    // rule text would not.
    it('rejects an id that looks like a real one', () => {
      expect(everyRuleIdKnown(['FP-06'])).toBe(false);
    });

    // Vacuously true, and deliberately so: "cited nothing" is not the same
    // failure as "cited something false". Whether an empty basis is
    // acceptable belongs to the caller that requires the field, not here.
    it('accepts an empty list', () => {
      expect(everyRuleIdKnown([])).toBe(true);
    });
  });
});
