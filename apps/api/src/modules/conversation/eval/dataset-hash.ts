import { createHash } from 'node:crypto';

/**
 * Stable hash of the golden dataset: the serialized case list plus the
 * fixture fields each case references (AC-6). Any change to a case or to a
 * referenced story or topic changes the hash, which marks baseline deltas as
 * not comparable rather than silently comparing different datasets.
 *
 * Object keys are sorted recursively so the hash reflects content, not
 * property insertion order.
 */
export function hashDataset(payload: unknown): string {
  return createHash('sha256')
    .update(stableStringify(payload))
    .digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
}
