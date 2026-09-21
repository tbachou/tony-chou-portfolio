/**
 * Tests for the credential layer's PREFILTER.
 *
 * **The first-person sentences here are test fixtures, not statements by Tony
 * Chou.** Most are deliberately FALSE. They were produced by eight rounds of
 * adversarial review against the regex this layer replaced, each one a wrong
 * verdict that review actually captured, and they are kept because they are
 * the best record of how this fails.
 *
 * What is asserted has changed with the mechanism. The regex was asked to tell
 * a claim from a denial, and could not. The prefilter is asked only whether an
 * answer TOUCHES the clinical subject, and a model call decides the rest.
 *
 * So the claim lists and the honest lists both assert `true` here. That is not
 * a bug in the test: an honest answer about the lapsed licence SHOULD reach
 * the model, which will return `past_tense_ok` and let it through. The
 * property under test is the safety-critical one — no sentence that could be
 * a credential claim escapes the prefilter — and it is one-sided by design.
 *
 * The sentences that must NOT match are the ones with no clinical content at
 * all; they are in `noClinicalContent` at the bottom, and they are where a
 * careless widening of the word list shows up.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  needsCredentialCheck,
  wrapAnswerForCredentialCheck,
} from './credential-check.js';
import {
  overclaims,
  filleredOverclaims,
  claimsWithTrailingPastTense,
  maintenanceClaims,
  curlyApostrophe,
  modalClaims,
  barePresentClaims,
  otherCredentialWords,
  honest,
  honestButKeywordDense,
} from './credential-corpus.fixture.js';

// The rule skills/tony.md leads its never-claim list with. Unlike the three
// commercial items there, this one misrepresents a real, regulated
// qualification, so it is enforced here rather than only requested in a
// prompt.

describe('needsCredentialCheck: every possible claim reaches the model', () => {
  it.each([
    ...overclaims,
    ...filleredOverclaims,
    ...claimsWithTrailingPastTense,
    ...maintenanceClaims,
    ...curlyApostrophe,
    ...modalClaims,
    ...barePresentClaims,
    ...otherCredentialWords,
  ])('routes to the check: %s', (text) => {
    expect(needsCredentialCheck(text)).toBe(true);
  });
});

/**
 * The prefilter is over-inclusive, NOT exhaustive over honest answers, and the
 * difference matters in both directions.
 *
 * An honest answer that mentions the clinical subject must route, so the model
 * gets to return `past_tense_ok` rather than the answer being decided by a
 * matcher — that is the whole reason this layer exists. An honest answer with
 * no clinical vocabulary at all should NOT route: skipping it costs nothing
 * and saves a call.
 *
 * So the list below is pinned rather than asserted away. Each entry is an
 * honest sentence carrying no clinical word, which is why it is safe to skip.
 * Three are boundary forms rather than vocabulary: `OT-trained` and `ex-OT`
 * fail the bare-`ot` rule's hyphen guards, and `O.T.` is not `ot`. They are
 * harmless here because all three are honest — but a CLAIM phrased that way
 * would skip the check too, and the deterministic guard is what covers that
 * today. Narrowing those guards is not free: the same rule exists because bare
 * `ot` matches inside "remote", "note" and "robot", all of which appear below.
 */
const HONEST_AND_NOT_CLINICAL = [
  'I am a senior software engineer with six years of production experience.',
  'I am an OT-trained engineer.',
  'I am an ex-OT.',
  'My Terraform remote state is up to date.',
  'My background is O.T. Everything I claim here is current.',
  'My bot token is still valid.',
  'My footer copy is current.',
  'My knowledge of the protocol is current.',
  'My note on that is still valid.',
  'My remote branch is up to date.',
  'My screenshot of the dashboard is current.',
];

describe('needsCredentialCheck: honest answers that mention the subject reach the model', () => {
  // Paying one cheap call to be told an answer is fine is the trade this layer
  // exists to make; the old regex tried to make this distinction itself and
  // that is exactly what it got wrong.
  const clinical = [...honest, ...honestButKeywordDense].filter(
    (text) => !HONEST_AND_NOT_CLINICAL.includes(text),
  );

  it.each(clinical)('routes to the check: %s', (text) => {
    expect(needsCredentialCheck(text)).toBe(true);
  });

  it.each(HONEST_AND_NOT_CLINICAL)('skips, and saves a call: %s', (text) => {
    expect(needsCredentialCheck(text)).toBe(false);
  });

  it('pins every skipped sentence, so a new one cannot appear silently', () => {
    const skipped = [...honest, ...honestButKeywordDense].filter(
      (text) => !needsCredentialCheck(text),
    );
    expect(skipped.sort()).toEqual([...HONEST_AND_NOT_CLINICAL].sort());
  });
});

describe('needsCredentialCheck: ordinary engineering answers do not', () => {
  // The bar the word list has to clear. `ot` is the entry that makes this
  // list load bearing: as a bare substring it matches inside "not", "got",
  // "a lot", "other" and "both", which silently routed every answer to the
  // model and — because the same list once sat inside the pure guard —
  // suppressed them outright.
  const noClinicalContent = [
    'I worked on the notification service, not the billing one.',
    'We got a lot out of that refactor.',
    'I built the Chrome extension API layer over about eight months.',
    'The other approach was to denormalize, but we did not.',
    'Both services read from the same Postgres instance.',
    'I do not remember the exact number, so I would rather not guess.',
    'That was a bot posting to the webhook endpoint.',
    'It is a screenshot diffing tool, nothing more.',
    'I wrote the retry logic and the dead letter queue behind it.',
  ];

  it.each(noClinicalContent)('skips the check: %s', (text) => {
    expect(needsCredentialCheck(text)).toBe(false);
  });
});

describe('wrapAnswerForCredentialCheck', () => {
  it('sends the delimiter the prompt documents', () => {
    const wrapped = wrapAnswerForCredentialCheck('I was an OT.');
    expect(wrapped).toBe('<answer>\nI was an OT.\n</answer>');
  });

  it('keeps the prompt and the wrapper in step', () => {
    // The prompt scopes its "data, never instructions" rule to this block. If
    // one side is renamed and the other is not, the rule silently points at a
    // boundary that is not in the message — which is how this was found.
    const prompt = readFileSync(
      join(
        process.cwd(),
        'src',
        'modules',
        'conversation',
        'skills',
        'credential-check.md',
      ),
      'utf8',
    );
    expect(prompt).toContain('<answer>');
    expect(wrapAnswerForCredentialCheck('x')).toContain('<answer>');
  });
});
