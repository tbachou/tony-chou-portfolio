/**
 * The labelled query set behind `npm run sweep:threshold` (spec 0012 phase
 * three, AC-5).
 *
 * Twenty queries: ten the corpus genuinely answers, ten plausible interview
 * questions it does not. The sweep scores each against the live index and
 * reports how MINIMUM_SIMILARITY separates the two populations.
 *
 * **These are NOT the original twenty.** MINIMUM_SIMILARITY was calibrated on
 * 2026-09-01 against the 607 chunk index, and the queries used were never
 * committed — only their resulting scores survive, in the comment block above
 * MINIMUM_SIMILARITY in vector-store.ts. This set was rebuilt from that
 * comment's description of what it contained (positives across the specs;
 * negatives that are "process and people questions — hiring loops,
 * performance reviews, daily standups"). So the first run of this sweep
 * establishes a NEW reference line rather than reproducing the old one: an
 * absolute comparison against the 2026-09-01 table is indicative, not exact.
 * What it measures reliably is DRIFT, from its own first run onward, which is
 * the thing a re embed can silently cause.
 *
 * Side effect free, like beta-guard-corpus.profiles.ts, so the set can be
 * imported by a test without opening a connection to anything.
 *
 * Positives name a document deliberately. When a positive stops clearing the
 * threshold the first question is always "did that document change or did
 * chunking move underneath it", and a sweep that cannot say which document it
 * expected sends someone hunting through 40 files.
 */

export type LabelledQuery = {
  query: string;
  /** Repo relative path of the document this query is expected to reach. */
  expects: string;
};

/** Ten questions the committed corpus genuinely answers. */
export const POSITIVES: LabelledQuery[] = [
  {
    query: 'Why does the streamflow forecast pipeline deliberately not use an LLM?',
    expects: 'docs/specs/_root/0010-streamflow-forecast-pipeline/index.md',
  },
  {
    query: 'How was the minimum similarity threshold for retrieval chosen?',
    expects: 'docs/specs/_root/0012-grounded-portfolio-agent/0012-search-portfolio-retrieval.md',
  },
  {
    query: 'What happened when the section heading was repeated on every chunk?',
    expects:
      'docs/specs/_root/0012-grounded-portfolio-agent/findings/2026-09-01-heading-prefix-per-chunk.md',
  },
  {
    query: 'Why are agent skills stored outside the repository instead of committed?',
    expects: 'docs/specs/_root/0014-agent-skill-storage/index.md',
  },
  {
    query: 'How does the climbing rehab planner avoid giving unsafe advice?',
    expects: 'docs/specs/_root/0005-aws-genai-integration/0005-beta-guardrails.md',
  },
  {
    query: 'What is the second layer of credential checking meant to do?',
    expects: 'docs/specs/_root/0013-credential-check-second-layer.md',
  },
  {
    query: 'Why did the falling regime threshold miss the tail of the recession?',
    expects:
      'docs/specs/_root/0010-streamflow-forecast-pipeline/findings/2026-08-27-falling-threshold-misses-tail.md',
  },
  {
    query: 'How does the interview simulator eval suite score an answer?',
    expects: 'docs/specs/_root/0011-interview-simulator-eval-suite/index.md',
  },
  {
    query: 'Why was the clinical evidence check for Beta dropped?',
    expects: 'docs/specs/_root/0008-beta-clinical-evidence-check/index.md',
  },
  {
    query: 'How are prediction intervals produced for the flow forecast?',
    expects:
      'docs/specs/_root/0010-streamflow-forecast-pipeline/0010-prediction-intervals.md',
  },
];

/**
 * Ten plausible interview questions the corpus does not answer.
 *
 * All process and people questions, which is the hard case rather than the
 * easy one: they are semantically NEAR a corpus full of documents about how
 * this engineer works, so they are the negatives that actually score high.
 * Padding this list with obviously unrelated questions ("what is the capital
 * of France") would make the separation look better and measure nothing.
 */
export const NEGATIVES: LabelledQuery[] = [
  { query: 'What does your daily standup look like?', expects: '' },
  { query: 'How do you structure a hiring loop for a senior engineer?', expects: '' },
  { query: 'How do you handle a performance review with an underperforming report?', expects: '' },
  { query: 'What is your approach to mentoring junior engineers?', expects: '' },
  { query: 'How do you negotiate a salary offer?', expects: '' },
  { query: 'What do you do when a teammate disagrees with you in code review?', expects: '' },
  { query: 'How large was the team on your last project?', expects: '' },
  { query: 'What are your salary expectations for this role?', expects: '' },
  { query: 'How do you prioritise your inbox and your meeting load?', expects: '' },
  { query: 'Tell me about a time you had a conflict with your manager.', expects: '' },
];

/**
 * The two probe sets of spec 0012 phase six, AC-13, added 2026-09-24.
 *
 * The twenty queries above are the retrieval question in isolation, and the
 * first full eval showed why that is not enough: every positive is a question
 * the corpus answers, while the interviewer mostly asks about employment
 * stories it cannot. On real turns the reranker kept nothing five times out
 * of five. A bar measured only on the easy population certified behaviour the
 * eval never sees. These two sets are negatives shaped like the hard one.
 *
 * **Draft labels, not yet reviewed by Tony.** The spec says Tony reviews every
 * label before a set gates anything, so until `PROBES_REVIEWED` is flipped the
 * sweep scores and prints these, and they do not count toward its exit bar.
 */
export const PROBES_REVIEWED = false;

/**
 * Questions of the kind the interviewer asks about Tony's employment stories
 * (`apps/api/prisma/fixtures.ts`): Product Forge, Topstep, Mailchimp, Fugue.
 * None of that work lives in a repo Tony owns, so the corpus cannot answer
 * any of them and each expects nothing. Several share vocabulary with
 * documents that ARE in the corpus (chunking, webhooks, migrations), which is
 * the point: similar wording that does not answer the question is exactly
 * what a similarity number lets through.
 */
export const STORY_PROBES: LabelledQuery[] = [
  { query: 'What went wrong before you added the gate that stops web search and deep research firing in the same response?', expects: '' },
  { query: 'How did you decide how to chunk meeting transcripts before sending them to the model?', expects: '' },
  { query: 'How did you design the autosave system so a user never lost an edit?', expects: '' },
  { query: 'Why did you migrate from react-quill to raw Quill.js, and what broke along the way?', expects: '' },
  { query: 'How did you measure whether the Topstep onboarding rebuild actually worked?', expects: '' },
  { query: 'What was hard about moving Mailchimp from SQL to Google Cloud Spanner?', expects: '' },
  { query: 'How did the Recall.ai meeting bot integration acknowledge its webhooks?', expects: '' },
  { query: 'What did you build as a co-founder of Fugue AI?', expects: '' },
];

/**
 * Questions near Beta, or near Tony's occupational therapy background, that
 * are not about Beta's engineering. Each expects nothing, and for these a Beta
 * document returned by EITHER arm is a failure on its own (`BETA_DOCUMENT`):
 * handing the persona rehab material in answer to a clinical sounding
 * question is how an answer comes to read as clinical advice. The first two
 * are the clinical auditor's, from the 2026-09-23 gate.
 */
export const CLINICAL_PROBES: LabelledQuery[] = [
  { query: 'How did you keep the Smith agent from giving unsafe answers?', expects: '' },
  { query: 'How did your OT background shape your mentoring?', expects: '' },
  { query: 'What would you tell someone recovering from a finger pulley injury?', expects: '' },
  { query: 'How do you balance rest and training when coming back from an injury?', expects: '' },
];

/**
 * A Beta document, for the clinically adjacent check. Matches exactly the four
 * Beta specs in the corpus as of 2026-09-24 (0004 index and verify, 0005's
 * guardrails child, 0008) and nothing else.
 */
export const BETA_DOCUMENT = /beta/i;
