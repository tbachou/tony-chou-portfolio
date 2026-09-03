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
