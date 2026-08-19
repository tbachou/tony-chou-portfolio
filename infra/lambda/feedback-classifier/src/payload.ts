import type { FeedbackCategory, FeedbackPayload, FeedbackSource } from './types';

const SOURCES: readonly FeedbackSource[] = ['beta', 'portfolio'];
const CATEGORIES: readonly Exclude<FeedbackCategory, null>[] = [
  'bug',
  'feature',
  'other',
];

/**
 * Parses and validates the raw SNS `Message` body against the intake
 * child's exact payload shape. Throws on anything malformed — callers
 * decide what "invalid" means for logging/alarming, this only guards the
 * shape.
 */
export function parsePayload(rawMessage: string): FeedbackPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawMessage);
  } catch {
    throw new Error('feedback payload is not valid JSON');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('feedback payload is not an object');
  }

  const candidate = parsed as Record<string, unknown>;

  if (typeof candidate.id !== 'string' || candidate.id.length === 0) {
    throw new Error('feedback payload missing string id');
  }
  if (
    typeof candidate.source !== 'string' ||
    !SOURCES.includes(candidate.source as FeedbackSource)
  ) {
    throw new Error('feedback payload has invalid source');
  }
  if (
    candidate.category !== null &&
    (typeof candidate.category !== 'string' ||
      !CATEGORIES.includes(candidate.category as Exclude<FeedbackCategory, null>))
  ) {
    throw new Error('feedback payload has invalid category');
  }
  if (typeof candidate.message !== 'string' || candidate.message.length === 0) {
    throw new Error('feedback payload missing string message');
  }
  if (typeof candidate.createdAt !== 'string' || candidate.createdAt.length === 0) {
    throw new Error('feedback payload missing string createdAt');
  }

  return {
    id: candidate.id,
    source: candidate.source as FeedbackSource,
    category: candidate.category as FeedbackCategory,
    message: candidate.message,
    createdAt: candidate.createdAt,
  };
}
