import { hashDataset } from './dataset-hash';

describe('hashDataset', () => {
  it('is stable across object key order', () => {
    expect(hashDataset({ a: 1, b: [1, 2], c: 'x' })).toBe(
      hashDataset({ c: 'x', b: [1, 2], a: 1 }),
    );
  });

  it('changes when content changes', () => {
    expect(hashDataset({ a: 1 })).not.toBe(hashDataset({ a: 2 }));
  });

  it('ignores undefined properties but keeps nulls', () => {
    expect(hashDataset({ a: 1, b: undefined })).toBe(hashDataset({ a: 1 }));
    expect(hashDataset({ a: 1, b: null })).not.toBe(hashDataset({ a: 1 }));
  });

  it('distinguishes array order', () => {
    expect(hashDataset([1, 2])).not.toBe(hashDataset([2, 1]));
  });
});
