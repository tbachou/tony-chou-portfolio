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
  readonly licence:
    | 'cc0'
    | 'cc-by'
    | 'cc-by-sa'
    | 'cc-by-nc'
    | 'cc-by-nc-nd'
    /** Free to read (e.g. on PMC) but no reuse grant; treat as closed for text. */
    | 'none'
    | 'closed';
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
 * The sources, once each.
 *
 * Every field below was resolved on 2026-09-19 by re-querying Crossref and
 * PubMed from scratch rather than by copying a search result forward, and
 * none was written from memory: 48 of 48 candidates resolved with title,
 * first author, year and journal matching. `url` prefers the PubMed Central
 * full text where one exists, because that is the copy a reader can open;
 * otherwise it is the PubMed record. `licence` is taken from the article's
 * own permissions block, not from Crossref, whose licence field was wrong or
 * missing for three of these.
 *
 * A rule cites a source through `cite()`, which pairs the fixed reference
 * with what that source establishes FOR THAT RULE. The same paper can support
 * one rule and merely document practice for another, so `supports` belongs
 * to the pairing, not to the reference. A `supports` that begins
 * "Counterweight:" records a source that cuts against the rule; it is kept
 * in the same list so the rule cannot be read as settled.
 */
type SourceRef = Omit<ClinicalRuleSource, 'supports'>;

function cite(ref: SourceRef, supports: string): ClinicalRuleSource {
  return { ...ref, supports };
}

const SILBERNAGEL_2007: SourceRef = {
  citation:
    'Silbernagel KG, Thomeé R, Eriksson BI, Karlsson J. Continued sports activity, using a pain-monitoring model, during rehabilitation in patients with Achilles tendinopathy: a randomized controlled study. Am J Sports Med 2007;35:897-906',
  doi: '10.1177/0363546506298279',
  url: 'https://pubmed.ncbi.nlm.nih.gov/17307888/',
  licence: 'closed',
};
const SPRAGUE_2021: SourceRef = {
  citation:
    'Sprague AL, et al. Pain-guided activity modification during treatment for patellar tendinopathy: a feasibility and pilot randomized clinical trial. Pilot Feasibility Stud 2021;7:58',
  doi: '10.1186/s40814-021-00792-5',
  url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC7905015/',
  licence: 'cc-by',
};
const HANLON_2026: SourceRef = {
  citation:
    "Hanlon SL, et al. The feasibility of a novel exercise therapy and activity modification intervention for patients with Sever's disease. Pilot Feasibility Stud 2026;12",
  doi: '10.1186/s40814-026-01850-6',
  url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC13520403/',
  licence: 'cc-by-nc-nd',
};
const ULLERN_2025: SourceRef = {
  citation:
    'Raulline Ullern K, et al. Painful considerations in exercise-management for rotator cuff related shoulder pain: a scoping review on pain-related prescription parameters. BMC Musculoskelet Disord 2025;26:180',
  doi: '10.1186/s12891-025-08411-7',
  url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC11846222/',
  licence: 'cc-by',
};
const RICH_2025: SourceRef = {
  citation:
    'Rich A, Cook J, Hahne A, Ford J. Treatment of proximal hamstring tendinopathy with individualized physiotherapy: a clinical commentary. Int J Sports Phys Ther 2025;20:892-910',
  doi: '10.26603/001c.138308',
  url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC12129629/',
  licence: 'cc-by-nc',
};
const THOMEE_1997: SourceRef = {
  citation:
    'Thomeé R. A comprehensive treatment approach for patellofemoral pain syndrome in young women. Phys Ther 1997;77:1690-703',
  doi: '10.1093/ptj/77.12.1690',
  url: 'https://pubmed.ncbi.nlm.nih.gov/9413448/',
  licence: 'closed',
};
const COOK_PURDAM_2009: SourceRef = {
  citation:
    'Cook JL, Purdam CR. Is tendon pathology a continuum? A pathology model to explain the clinical presentation of load-induced tendinopathy. Br J Sports Med 2009;43:409-16',
  doi: '10.1136/bjsm.2008.051193',
  url: 'https://pubmed.ncbi.nlm.nih.gov/18812414/',
  licence: 'closed',
};
const COOK_2016: SourceRef = {
  citation:
    'Cook JL, Rio E, Purdam CR, Docking SI. Revisiting the continuum model of tendon pathology: what is its merit in clinical practice and research? Br J Sports Med 2016;50:1187-91',
  doi: '10.1136/bjsports-2015-095422',
  url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC5118437/',
  licence: 'cc-by-nc',
};
const CAMPOS_VILLEGAS_2024: SourceRef = {
  citation:
    'Campos-Villegas C, et al. Clinical progression and load management for proximal hamstring tendinopathy in a long-distance runner: a case report. Int J Sports Phys Ther 2024;19:609-617',
  doi: '10.26603/001c.116578',
  url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC11065772/',
  licence: 'cc-by-nc',
};
const EHIOGU_2023: SourceRef = {
  citation:
    'Ehiogu UD, Schöffl V, Jones G. Rehabilitation of annular pulley injuries of the fingers in climbers: a clinical commentary. Curr Sports Med Rep 2023;22:345-352',
  doi: '10.1249/JSR.0000000000001107',
  url: 'https://pubmed.ncbi.nlm.nih.gov/37800745/',
  licence: 'closed',
};
const LARSSON_2022: SourceRef = {
  citation:
    'Larsson R, Nordeman L, Blomdahl C. To tape or not to tape: annular ligament (pulley) injuries in rock climbers — a systematic review. BMC Sports Sci Med Rehabil 2022;14:148',
  doi: '10.1186/s13102-022-00539-6',
  url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC9344739/',
  licence: 'cc-by',
};
const SCHOFFL_2009: SourceRef = {
  citation:
    'Schöffl I, et al. The influence of the crimp and slope grip position on the finger pulley system. J Biomech 2009;42:2183-7',
  doi: '10.1016/j.jbiomech.2009.04.049',
  url: 'https://pubmed.ncbi.nlm.nih.gov/19665129/',
  licence: 'closed',
};
const MERGOUM_2025: SourceRef = {
  citation:
    'Mergoum A, et al. Tendon and ligament injuries of the finger and thumb in athletes: a narrative review. BMJ Open Sport Exerc Med 2025;11:e002475',
  doi: '10.1136/bmjsem-2025-002475',
  url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC12164644/',
  licence: 'cc-by-nc',
};
const MIRO_2021: SourceRef = {
  citation:
    'Miro PH, vanSonnenberg E, Sabb DM, Schöffl V. Finger flexor pulley injuries in rock climbers. Wilderness Environ Med 2021;32:247-258',
  doi: '10.1016/j.wem.2021.01.011',
  url: 'https://pubmed.ncbi.nlm.nih.gov/33966972/',
  licence: 'closed',
};
const YOON_2021: SourceRef = {
  citation:
    'Yoon SY, et al. The beneficial effects of eccentric exercise in the management of lateral elbow tendinopathy: a systematic review and meta-analysis. J Clin Med 2021;10:3968',
  doi: '10.3390/jcm10173968',
  url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC8432114/',
  licence: 'cc-by',
};
const SVEINALL_2024: SourceRef = {
  citation:
    'Sveinall H, et al. Heavy slow resistance training, radial extracorporeal shock wave therapy or advice for patients with tennis elbow in the Norwegian secondary care: a randomised controlled feasibility trial. BMJ Open 2024;14:e085916',
  doi: '10.1136/bmjopen-2024-085916',
  url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC11667321/',
  licence: 'cc-by-nc',
};
const STASINOPOULOS_2022: SourceRef = {
  citation:
    'Stasinopoulos D. Stop using the eccentric exercises as the gold standard treatment for the management of lateral elbow tendinopathy. J Clin Med 2022;11:1325',
  doi: '10.3390/jcm11051325',
  url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC8911334/',
  licence: 'cc-by',
};
const SEE_2026: SourceRef = {
  citation:
    'See ZH, Loo CE, Jaafar Z. Eccentric exercise therapy for medial epicondylitis: a systematic review of clinical outcomes. Complement Ther Med 2026;98:103364',
  doi: '10.1016/j.ctim.2026.103364',
  url: 'https://pubmed.ncbi.nlm.nih.gov/41887339/',
  licence: 'cc-by-nc-nd',
};
const DEMANGEOT_2025: SourceRef = {
  citation:
    'Demangeot Y, et al. Exercise parameters to consider for Achilles tendinopathy: a modified Delphi study with international experts. Br J Sports Med 2025;59:1337-1349',
  doi: '10.1136/bjsports-2025-110183',
  url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC12573378/',
  licence: 'cc-by-nc',
};
const CHEPEHA_2025: SourceRef = {
  citation:
    'Chepeha J, et al. A standardized criteria-based progressive shoulder exercise program is effective in managing rotator cuff-related shoulder pain: a prospective cohort study. PLoS One 2025;20:e0328728',
  doi: '10.1371/journal.pone.0328728',
  url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC12286389/',
  licence: 'cc-by',
};
const DUTCH_SAPS_2026: SourceRef = {
  citation:
    'Lambers Heerspink FO, et al. Update of guideline for diagnosis and treatment of subacromial pain syndrome: a multidisciplinary review by the Dutch Orthopedic Association. Part 1: preventive measures, diagnostics, and non-surgical treatment. Acta Orthop 2026;97:91-98',
  doi: '10.2340/17453674.2026.45365',
  url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC12908218/',
  licence: 'cc-by',
};
const KARAKUZU_2026: SourceRef = {
  citation:
    'Karakuzu Güngör Z, Tan MS. Effect of scapular stabilization and mobilization-based rehabilitation on pain and shoulder function in subacromial impingement syndrome: a randomized controlled trial. BMC Musculoskelet Disord 2026;27',
  doi: '10.1186/s12891-026-09760-7',
  url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC13088711/',
  licence: 'cc-by-nc-nd',
};
const WU_2025: SourceRef = {
  citation:
    'Wu D, et al. Specific modes of exercise to improve rotator cuff-related shoulder pain: systematic review and meta-analysis. Front Bioeng Biotechnol 2025;13:1560597',
  doi: '10.3389/fbioe.2025.1560597',
  url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC12011739/',
  licence: 'cc-by',
};
const ROBLES_PEREZ_2025: SourceRef = {
  citation:
    'Robles-Pérez R, et al. Thoracic manual therapy with or without exercise improves pain and disability in subacromial pain syndrome: a systematic review of randomized trials. Healthcare 2025;13:2479',
  doi: '10.3390/healthcare13192479',
  url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC12523727/',
  licence: 'cc-by',
};

const SCHOFFL_2006: SourceRef = {
  citation:
    'Schöffl VR, Schöffl I. Injuries to the finger flexor pulley system in rock climbers: current concepts. J Hand Surg Am 2006;31:647-54',
  doi: '10.1016/j.jhsa.2006.02.011',
  url: 'https://pubmed.ncbi.nlm.nih.gov/16632061/',
  licence: 'closed',
};
const HARTNETT_2024: SourceRef = {
  citation:
    'Hartnett E, Bondoc S, Feretti AM. Climbing while healing: an orthotic intervention for rock climbers with a low-grade A2 pulley injury, a case series. J Hand Ther 2024;37:419-428',
  doi: '10.1016/j.jht.2023.08.005',
  url: 'https://pubmed.ncbi.nlm.nih.gov/37805347/',
  licence: 'closed',
};
const DAY_2019: SourceRef = {
  citation:
    'Day JM, Lucado AM, Uhl TL. A comprehensive rehabilitation program for treating lateral elbow tendinopathy. Int J Sports Phys Ther 2019;14:818-829',
  doi: '10.26603/ijspt20190818',
  url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC6769266/',
  licence: 'none',
};
const DAY_2015: SourceRef = {
  citation:
    'Day JM, Bush H, Nitz AJ, Uhl TL. Scapular muscle performance in individuals with lateral epicondylalgia. J Orthop Sports Phys Ther 2015;45:414-24',
  doi: '10.2519/jospt.2015.5290',
  url: 'https://pubmed.ncbi.nlm.nih.gov/25579691/',
  licence: 'closed',
};
const DAY_2021: SourceRef = {
  citation:
    'Day JM, et al. The effect of scapular muscle strengthening on functional recovery in patients with lateral elbow tendinopathy: a pilot randomized controlled trial. J Sport Rehabil 2021;30:744-753',
  doi: '10.1123/jsr.2020-0203',
  url: 'https://pubmed.ncbi.nlm.nih.gov/33440342/',
  licence: 'closed',
};

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
    evidence: 'sort-b',
    sources: [
      cite(
        SILBERNAGEL_2007,
        'The RCT behind the pain-monitoring model: continued Achilles loading under it did not worsen outcomes. Establishes that the model is safe to train under; the numbers are not from this paper.',
      ),
      cite(
        SPRAGUE_2021,
        'States the model as a 5/10 ceiling during or immediately after activity, with pain returning to its pre-activity level by the following morning. Sources the next-morning clause; governs activity, not exercise dosing.',
      ),
      cite(
        HANLON_2026,
        'The same rule in a second trial from the same lineage as Sprague 2021. Corroborating, not independent.',
      ),
      cite(
        ULLERN_2025,
        'Documents 3/10 as one of the two most common during-exercise limits in shoulder trials (14%, four trials, tied with 4/10), traces the model to the Thomeé band in which 2-5 is acceptable, and states that no study has validated any limit. Counterweight: warns that a static 3/10 ceiling may reinforce maladaptive pain behaviour and hinder adherence.',
      ),
      cite(
        RICH_2025,
        'The closest published number to 3/10, but applied to a pain increase persisting past 24 hours, not to pain during activity. A different clause; not imported.',
      ),
      cite(
        THOMEE_1997,
        'Origin of the model: under 2 safe, 2-5 acceptable, over 5 high risk, conditional on settling by the next morning. Provenance only. The morning-stiffness clause of this rule has no source in any of these papers.',
      ),
    ],
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
    evidence: 'sort-c',
    sources: [
      cite(
        RICH_2025,
        'A five-stage tendinopathy programme in which stages 1-2 are isometric and isotonic and the highest-demand energy-storage work sits at stage 5, with a stated rationale. Describes a programme prospectively, for one lower-limb tendon; does not assert a prohibition.',
      ),
      cite(
        COOK_PURDAM_2009,
        'The tendon-continuum model: the mechanism for avoiding maximal load early. Mechanism, not prescription.',
      ),
      cite(
        COOK_2016,
        'Revisits the continuum model; the readable version of the same mechanism.',
      ),
      cite(
        CAMPOS_VILLEGAS_2024,
        'A single case report of staged load management. Corroborating only.',
      ),
    ],
  },

  // --- finger_pulley (A2 pulley strain) ------------------------------------
  {
    id: 'FP-01',
    scope: 'finger_pulley',
    text: 'Early: Beta does not know how severe the injury is, and published guidance protects all but the mildest pulley injuries before loading them, so a fresh injury starts with a short protection phase — no finger loading and no climbing, only pain-free tendon glides and light massage — before protected motion (gentle open-hand putty or rice-bucket work). The advance criteria, not the time window, release the visitor from protection. No crimping of any kind.',
    evidence: 'sort-c',
    sources: [
      cite(
        SCHOFFL_2006,
        'The field-standard current-concepts paper: initial protection before loading for all but the mildest pulley injuries, then protected motion. The source this rule was tightened to match on 2026-09-19; before that it began with motion.',
      ),
      cite(
        MERGOUM_2025,
        'Grade-stratified return-to-play review: initial immobilisation for every grade but the mildest, 10-14 days for grade II. With Schöffl 2006, the reason the early phase now leads with protection.',
      ),
      cite(
        SCHOFFL_2009,
        'Cadaver loading data behind the crimp prohibition: A2 pulley force 287 N in crimp versus 121 N in slope grip.',
      ),
      cite(
        HARTNETT_2024,
        'Counterweight: four climbers with low-grade injuries kept climbing three times a week in a pulley ring orthosis for 12 weeks and improved. n=4, no control; recorded so the early prohibition is not read as settled.',
      ),
    ],
  },
  {
    id: 'FP-02',
    scope: 'finger_pulley',
    text: 'Middle: progressive loading — open-hand isometric holds at low load (a light pick-up block or hangboard with feet fully weighted), finger extensions against a rubber band.',
    evidence: 'sort-c',
    sources: [
      cite(
        EHIOGU_2023,
        'Clinical commentary holding that pulley rehabilitation should be grounded in strength-and-conditioning principles with progressive loading as its foundation. Expert opinion for the principle, read from the abstract only; it contains no phases, addresses traumatic rupture, and names none of the exercises in this rule.',
      ),
      cite(
        LARSSON_2022,
        'Systematic review of taping; supports the open-hand loading premise. Its 6-8 week and 3-month timelines are restatements of Schöffl 2003/2004 and are not cited from here.',
      ),
    ],
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
    evidence: 'sort-c',
    sources: [
      cite(
        SCHOFFL_2009,
        'Cadaver biomechanics: A2 pulley force 287 N in crimp versus 121 N in slope grip, and A4 rupture in 50% of crimp-loaded fingers versus 0% in slope. Disease-oriented evidence for ordering open hand before crimp; it cannot support the hold-size, wall-angle or grades-below-max progression.',
      ),
      cite(
        MERGOUM_2025,
        'Establishes that a staged, grade-dependent return to climbing exists as a published concept. Not the grip or terrain staging in this rule.',
      ),
    ],
  },
  {
    id: 'FP-05',
    scope: 'finger_pulley',
    text: 'Never program full-crimp training. The plan ends at "half-crimp comfortable under load, begin cautious return to normal climbing".',
    evidence: 'sort-c',
    sources: [
      cite(
        MIRO_2021,
        'Review of pulley injury mechanism in climbers. Supports the mechanism behind avoiding full crimp, not the end-state prescription.',
      ),
      cite(
        SCHOFFL_2009,
        'The same cadaver loading data as FP-04: the premise for treating full crimp as the last grip to return.',
      ),
    ],
  },

  // --- elbow_tendinopathy (climber's elbow — medial or lateral) ------------
  {
    id: 'ET-01',
    scope: 'elbow_tendinopathy',
    text: 'The core is slow, heavy-ish, pain-monitored loading: eccentric or slow-tempo wrist curls (dumbbell, band, or a loaded household bag), reverse wrist curls for the lateral side, forearm massage and stretching as accessories.',
    evidence: 'sort-b',
    sources: [
      cite(
        YOON_2021,
        'Meta-analysis: eccentric exercise is beneficial in lateral elbow tendinopathy, with buckets and water-filled containers among the published trial equipment, which legitimises household-object loading. States that no optimal protocol could be determined, so it does not reach dosing. Its extracted table shows the literature most often prescribes daily.',
      ),
      cite(
        SVEINALL_2024,
        'The only complete elbow protocol found: 4s/4s tempo dumbbell wrist extension, three times a week, at least 48 hours of recovery. Counterweight: the heavy-slow-resistance arm had low compliance from pain aggravation and the authors judged it unsuitable for tennis elbow, so "heavy-ish" is contested by the closest trial.',
      ),
      cite(
        STASINOPOULOS_2022,
        'Counterweight, editorial: argues that eccentric-only loading is outdated and the whole upper-limb kinetic chain should be loaded. Recorded so the rule does not read as settled.',
      ),
      cite(
        SEE_2026,
        'Systematic review of eccentric therapy for medial epicondylitis; supports the principle for the medial side. Abstract only.',
      ),
    ],
  },
  {
    id: 'ET-02',
    scope: 'elbow_tendinopathy',
    text: 'Add shoulder-blade and rotator-cuff support work in the middle stages; scapular weakness is commonly found alongside elbow tendinopathy.',
    evidence: 'sort-c',
    sources: [
      cite(
        DAY_2015,
        'Case-control study finding scapular muscle weakness alongside lateral epicondylalgia. Supports the association this rule now states; the authors write that cause and effect cannot be established, which is why the earlier causal wording was removed on 2026-09-19.',
      ),
      cite(
        DAY_2019,
        'Clinical commentary describing a comprehensive lateral elbow programme that includes scapular strengthening. Expert opinion; the abstract says the protocol was then untested, and the body was not read. The DOI target is dead, so the PMC link is the durable one.',
      ),
      cite(
        DAY_2021,
        'Counterweight: the pilot RCT that tested adding scapular strengthening found no between-group difference. n=32, both arms already receiving a full multimodal package; a failure to show benefit, not a demonstration of none.',
      ),
    ],
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
    evidence: 'sort-c',
    sources: [
      cite(
        ULLERN_2025,
        'Documents 3/10 as one of the two most common during-exercise limits (14%, four trials, tied with 4/10), attributes the pain-monitoring model to Thomeé, and states that no study has validated any limit. Counterweight: warns that a static 3/10 ceiling may reinforce maladaptive pain behaviour.',
      ),
      cite(
        SVEINALL_2024,
        'Prescribes three sessions a week with at least 48 hours of recovery, matching "every other day" as a published design parameter. The frequency itself was never tested, and the elbow eccentric literature more often prescribes daily.',
      ),
      cite(
        DEMANGEOT_2025,
        'International Delphi on Achilles tendinopathy parameters, supporting consistency over weeks rather than intensity. A different tendon.',
      ),
      cite(
        COOK_2016,
        'Conceptual origin of the pain-behaviour framing: warms-up-then-fine as tendon behaviour.',
      ),
    ],
  },

  // --- shoulder_impingement (subacromial pain / rotator cuff overload) -----
  {
    id: 'SI-01',
    scope: 'shoulder_impingement',
    text: 'Early: calm the irritation while keeping motion — pendulums, wall slides in pain-free range, isometric external rotation at the side.',
    evidence: 'sort-c',
    sources: [
      cite(
        CHEPEHA_2025,
        'Single-arm prospective cohort documenting a criteria-based progressive programme: a calm-and-move early phase, three sets, an RPE target of 4-6 on the modified Borg scale (exertion, not a pain threshold), "to but not through" pain, and a 2/6/12-week referral algorithm. Contains no pendulums, wall slides or isometric external rotation. Uncontrolled; cannot establish effectiveness.',
      ),
      cite(
        DUTCH_SAPS_2026,
        'National guideline (GRADE, AGREE) supporting gradual loading within a comfort zone. Contains no exercise-therapy module and states that scientific evidence is lacking on the form or protocol of exercise therapy.',
      ),
      cite(
        ULLERN_2025,
        'Documents pain-threshold progression as common practice in shoulder trials while concluding that the evidence for any specific parameter is insufficient.',
      ),
    ],
  },
  {
    id: 'SI-02',
    scope: 'shoulder_impingement',
    text: 'Middle: rotator cuff and scapular strength — band external rotations, rows, band pull-aparts, serratus wall slides or push-up-plus; add thoracic mobility.',
    evidence: 'sort-c',
    sources: [
      cite(
        KARAKUZU_2026,
        'RCT (n=63) whose intervention arm performed wall slides, resisted rows, push-up plus, serratus punch, prone Y/T/W and band work at 3x10-15, a near line-by-line match with this list, alongside 10-12 minutes per session of clinician-delivered passive scapular mobilisation that the control arm did not receive. Documents the exercise selection as published practice. The tested increment is a bundle Beta cannot deliver, and every between-group difference fell below the MCID the paper itself cites.',
      ),
      cite(
        WU_2025,
        'Meta-analysis of exercise modes for rotator-cuff-related shoulder pain, corroborating the scapular element. Abstract only; nothing on staging.',
      ),
      cite(
        ROBLES_PEREZ_2025,
        'Systematic review supporting the thoracic region as a valid target in subacromial pain. Studies clinician-delivered manual therapy, not self-performed mobility.',
      ),
      cite(
        CHEPEHA_2025,
        'Documents rotator cuff and scapular strengthening as the middle phase of a criteria-based programme.',
      ),
    ],
  },
  {
    id: 'SI-03',
    scope: 'shoulder_impingement',
    text: 'Later: overhead tolerance — progressive overhead pressing motion with light load before big overhead climbing moves.',
    evidence: 'sort-c',
    sources: [
      cite(
        DUTCH_SAPS_2026,
        'Guideline-level support for the gradual-loading principle only. Progressive overhead pressing as a late stage does not appear in the subacromial pain literature.',
      ),
      cite(
        CHEPEHA_2025,
        'Phase skeleton only; its late phase is not an overhead-pressing progression.',
      ),
    ],
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
