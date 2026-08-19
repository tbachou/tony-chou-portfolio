// Mirrors the exact SNS payload shape published by the api
// (docs/specs/_root/0005-aws-genai-integration/0005-feedback-intake.md):
//   { id, source, category, message, createdAt }
// This is the only data crossing to AWS (AC-C4 / umbrella cross-child
// contract) — never widen this shape to carry anything else.

export type FeedbackSource = 'beta' | 'portfolio';
export type FeedbackCategory = 'bug' | 'feature' | 'other' | null;

export interface FeedbackPayload {
  id: string;
  source: FeedbackSource;
  category: FeedbackCategory;
  message: string;
  createdAt: string;
}

export type ClassificationLabel =
  | 'bug'
  | 'feature'
  | 'praise'
  | 'other'
  | 'unclassified';

export interface Classification {
  label: ClassificationLabel;
  summary: string;
}

export const UNCLASSIFIED: Classification = {
  label: 'unclassified',
  summary: '',
};
