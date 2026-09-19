// Beta's clinical claim registry (spec 0008 successor; see the note at the
// bottom of this file for why 0008 itself was rejected and what changed).
//
// WHAT THIS IS: every clinical claim Beta makes, lifted verbatim out of
// `skills/drafter.md` and given a stable id. Nothing here is read at runtime
// yet. It exists so a claim can be pointed at — by a citation, by an evidence
// label, and eventually by the drafter's own output.
//
// WHAT THIS IS NOT: a source of truth for the model. `drafter.md` remains the
// prompt; this file mirrors it. `clinical-rules.spec.ts` fails if the two
// drift, which is the enforcement the maintainer note in drafter.md asks for
// in prose and cannot apply on its own.
//
// SCOPE: clinical claims only — statements about what an injured body does and
// what loading it tolerates. Structural rules ("never exceed 5 stages", "every
// number must be concrete") are deliberately absent: they are output-shape
// contracts, no published source could ever support them, and mixing them in
// would leave permanently ungradeable rows in a registry whose whole purpose
// is grading.
//
// PROVENANCE OF THE BASELINE: every rule here was written by Tony Chou, who
// held an Ohio Occupational Therapist License (Ohio OTPTAT Board) and NBCOT
// board certification, both now expired, and is no longer in clinical
// practice. The content is his own clinical reasoning — the pain
// traffic-light thresholds, the three-week rest-pain rule, the tendon
// behaviour guidance, and the injury-specific sections — and none of it was
// drawn from a literature review. Spec 0008's rationale records the same and
// states plainly that none of it links to a published source.
//
// That is why every row currently reads `author-judgement`, and the label
// needs reading precisely. It tracks PROCESS, not competence: it says no
// literature check has been run against this rule, which is equally true of a
// board-certified clinician's claim and an enthusiast's. Under SORT those two
// are not equivalent — expert opinion from a credentialed clinician in the
// relevant specialty is a stronger Level C than the same words from someone
// without the training. Recording the credential here is what lets a reader
// draw that distinction once the grading in 2b begins.

import type { InjuryArea } from '@portfolio/shared';

/**
 * What backs a claim.
 *
 * `author-judgement` is a positive statement, not an empty one, and the
 * distinction matters enough to be the reason this union exists. It says: this
 * rule was written by the author from his own clinical practice, and no
 * literature check has been run against it yet. That is different from "this
 * has no basis" and different again from "someone checked and found only
 * opinion-level support" — which is `sort-c`, and which nobody can claim until
 * they have actually read something.
 *
 * Collapsing those three states is how a registry starts lying. An unchecked
 * rule silently graded `sort-c` reads as a completed review, and a stated
 * level of support that exceeds the real one is a worse position to be in
 * than having claimed nothing. So a rule stays `author-judgement` until a
 * human has read a source, and the honest ceiling on this file today is
 * exactly that.
 *
 * The graded values follow SORT (AAFP's Strength of Recommendation Taxonomy),
 * chosen over inventing a scheme because it is published, has defined wording,
 * and is recognisable to a clinician reading the repo:
 *
 * - `sort-a` — consistent, good-quality patient-oriented evidence.
 * - `sort-b` — inconsistent or limited-quality patient-oriented evidence.
 * - `sort-c` — consensus, usual practice, opinion, disease-oriented evidence,
 *   or case series. Much of this registry may well land here once checked, and
 *   that is a finding to state plainly rather than a result to improve away.
 */
export type EvidenceLabel =
  | 'author-judgement'
  | 'sort-a'
  | 'sort-b'
  | 'sort-c';

/**
 * A source backing a claim.
 *
 * `doi` and `url` identify the work; neither implies its text may be copied
 * into this repo. The working rule here is that citing a paper, linking it,
 * and restating a number in your own words are not licensing events, since
 * copyright protects expression rather than fact — so a closed-access paper
 * is citable. What may NOT appear in this repo is
 * substantial verbatim text from a source that has not granted it: quote only
 * within fair use / fair dealing, and keep committed passages to CC0, CC BY,
 * or CC BY-SA. `licence` records which case a source falls under so that line
 * stays visible at review time rather than being re-derived from memory.
 */
export interface ClinicalRuleSource {
  readonly citation: string;
  readonly doi?: string;
  readonly url?: string;
  readonly licence: 'cc0' | 'cc-by' | 'cc-by-sa' | 'cc-by-nc' | 'closed';
  /** What this source actually supports, in the reviewer's own words. */
  readonly supports: string;
}

export interface ClinicalRule {
  /** Stable and opaque. Never renumber: an id may already be cited. */
  readonly id: string;
  /** The injury the claim is specific to, or `general` if it spans all. */
  readonly scope: InjuryArea | 'general';
  /** Verbatim from `skills/drafter.md`. The spec file enforces this. */
  readonly text: string;
  readonly evidence: EvidenceLabel;
  readonly sources: readonly ClinicalRuleSource[];
}

/**
 * Ids are prefixed by scope (`GEN`, `FP`, `ET`, `SI`) and never reused.
 *
 * The text is copied character for character out of `drafter.md`, including
 * its em dashes and its quotation marks. That is not fussiness: the spec
 * asserts each string is a substring of the prompt file, so a paraphrase here
 * fails the build, which is exactly the drift the registry exists to catch.
 */
export const CLINICAL_RULES: readonly ClinicalRule[] = [
  // --- General: claims that apply whatever the injury -----------------------
  {
    id: 'GEN-01',
    scope: 'general',
    text: 'Use the pain traffic light: pain during activity no more than about 3 out of 10, settling by the next morning, and no increased morning stiffness.',
    evidence: 'author-judgement',
    sources: [],
  },
  {
    id: 'GEN-02',
    scope: 'general',
    text: 'that pain which stays constant even at rest, and has not clearly improved by about three weeks from onset, deserves a professional assessment.',
    evidence: 'author-judgement',
    sources: [],
  },
  {
    id: 'GEN-03',
    scope: 'general',
    text: 'Do not include any exercise that loads the injured structure maximally in the first two stages.',
    evidence: 'author-judgement',
    sources: [],
  },

  // --- finger_pulley (A2 pulley strain) ------------------------------------
  {
    id: 'FP-01',
    scope: 'finger_pulley',
    text: 'Early: protected motion, not total rest — tendon glides, gentle open-hand putty or rice-bucket work, light massage. No crimping of any kind.',
    evidence: 'author-judgement',
    sources: [],
  },
  {
    id: 'FP-02',
    scope: 'finger_pulley',
    text: 'Middle: progressive loading — open-hand isometric holds at low load (a light pick-up block or hangboard with feet fully weighted), finger extensions against a rubber band.',
    evidence: 'author-judgement',
    sources: [],
  },
  {
    id: 'FP-03',
    scope: 'finger_pulley',
    text: 'Later: gradual half-crimp reintroduction under load before any crimping on the wall.',
    evidence: 'author-judgement',
    sources: [],
  },
  {
    id: 'FP-04',
    scope: 'finger_pulley',
    text: 'Climbing progression: big open-hand holds on vertical terrain first, several number grades below their max; smaller holds and half-crimp later; full-crimp moves are the very last thing to return.',
    evidence: 'author-judgement',
    sources: [],
  },
  {
    id: 'FP-05',
    scope: 'finger_pulley',
    text: 'Never program full-crimp training. The plan ends at "half-crimp comfortable under load, begin cautious return to normal climbing".',
    evidence: 'author-judgement',
    sources: [],
  },

  // --- elbow_tendinopathy (climber's elbow — medial or lateral) ------------
  {
    id: 'ET-01',
    scope: 'elbow_tendinopathy',
    text: 'The core is slow, heavy-ish, pain-monitored loading: eccentric or slow-tempo wrist curls (dumbbell, band, or a loaded household bag), reverse wrist curls for the lateral side, forearm massage and stretching as accessories.',
    evidence: 'author-judgement',
    sources: [],
  },
  {
    id: 'ET-02',
    scope: 'elbow_tendinopathy',
    text: 'Add shoulder-blade and rotator-cuff support work in the middle stages; poor scapular control feeds elbow overload.',
    evidence: 'author-judgement',
    sources: [],
  },
  {
    id: 'ET-03',
    scope: 'elbow_tendinopathy',
    text: 'Climbing progression: feet-heavy vertical climbing on open grips early; limit steep terrain, lock-offs, and pockets until late stages.',
    evidence: 'author-judgement',
    sources: [],
  },
  {
    id: 'ET-04',
    scope: 'elbow_tendinopathy',
    text: 'Tendons respond to consistency over weeks, not intensity: doses stay modest and regular (roughly every other day), and "no pain" during loading is not required — up to about 3 out of 10 that settles by next morning is acceptable and normal.',
    evidence: 'author-judgement',
    sources: [],
  },

  // --- shoulder_impingement (subacromial pain / rotator cuff overload) -----
  {
    id: 'SI-01',
    scope: 'shoulder_impingement',
    text: 'Early: calm the irritation while keeping motion — pendulums, wall slides in pain-free range, isometric external rotation at the side.',
    evidence: 'author-judgement',
    sources: [],
  },
  {
    id: 'SI-02',
    scope: 'shoulder_impingement',
    text: 'Middle: rotator cuff and scapular strength — band external rotations, rows, band pull-aparts, serratus wall slides or push-up-plus; add thoracic mobility.',
    evidence: 'author-judgement',
    sources: [],
  },
  {
    id: 'SI-03',
    scope: 'shoulder_impingement',
    text: 'Later: overhead tolerance — progressive overhead pressing motion with light load before big overhead climbing moves.',
    evidence: 'author-judgement',
    sources: [],
  },
  {
    id: 'SI-04',
    scope: 'shoulder_impingement',
    text: 'Climbing progression: vertical terrain with hands below shoulder height bias early; wide gastons, big overhead reaches, dynamic moves, and steep roofs return last.',
    evidence: 'author-judgement',
    sources: [],
  },
];

/** Lookup by id. Built once; the registry is static. */
const BY_ID = new Map(CLINICAL_RULES.map((rule) => [rule.id, rule]));

export function findClinicalRule(id: string): ClinicalRule | undefined {
  return BY_ID.get(id);
}

/**
 * Whether every id in `ids` names a rule in this registry.
 *
 * This is the check a future `basis[]` field on `submit_plan` would run
 * against model output, and it is deliberately set membership over opaque
 * engineer-authored tokens: it compares an id to a fixed list, never one
 * stretch of model prose to another. Beta has been bitten twice by the latter
 * (the output guard's R2 substring match and R8 term-overlap ratio), and both
 * bugs shared that single root cause. An unknown id is a failure, so the
 * check fails closed.
 */
export function everyRuleIdKnown(ids: readonly string[]): boolean {
  return ids.every((id) => BY_ID.has(id));
}

// --- Why this file exists -------------------------------------------------
//
// Spec 0008 proposed checking Beta's numbers against a committed corpus of
// permissively licensed passages, and was rejected twice — once on a narrow
// timeline question (2026-08-22), then again after a second and deliberately
// broader sweep across five claim types and all three injuries (2026-08-31).
//
// This file is not an attempt to reopen it. It implements what that second
// sweep actually concluded: "write the citations into `drafter.md` by hand,
// and leave finger pulley exercise selection and the elbow progression rule
// explicitly uncited rather than implying grounding that does not exist". A
// claim cannot carry a hand-written citation, nor be marked honestly as
// uncited, until it has an identity to carry either. That identity is all
// this file adds.
//
// One correction to the record, found 2026-09-19. Both sweeps applied the
// CC0 / CC-BY / CC-BY-SA bar to whether a source could be USED at all, when
// that bar governs only whether its text may be REDISTRIBUTED. Citing a
// paper, linking its DOI and restating a number from it are not licensing
// events. The cost of the conflation is visible in the sweeps' own near
// misses: the IJSPT lateral elbow programme was set aside as CC BY-NC despite
// having "exactly the exercise, dosing and progression content Beta needs",
// and Cook and Purdam's tendon continuum model went unpursued for being
// closed. Both are perfectly citable.
//
// That does not revive the corpus — a corpus needs text, and the licence bar
// is correct for text. It widens only what the `sources` field below may
// point at, which is a smaller claim than the one this comment made before
// the 2026-08-31 sweep was read properly.
