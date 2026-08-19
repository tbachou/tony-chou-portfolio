import { parsePayload } from './payload';

const VALID = {
  id: 'cuid_123',
  source: 'portfolio',
  category: 'bug',
  message: 'the contact form is broken',
  createdAt: '2026-08-19T12:00:00.000Z',
};

describe('parsePayload', () => {
  it('parses a valid payload', () => {
    expect(parsePayload(JSON.stringify(VALID))).toEqual(VALID);
  });

  it('accepts a null category', () => {
    const withNullCategory = { ...VALID, category: null };
    expect(parsePayload(JSON.stringify(withNullCategory))).toEqual(withNullCategory);
  });

  it('throws on invalid JSON', () => {
    expect(() => parsePayload('not json')).toThrow();
  });

  it('throws on a non-object payload', () => {
    expect(() => parsePayload(JSON.stringify('a string'))).toThrow();
  });

  it('throws when id is missing', () => {
    const rest: Partial<typeof VALID> = { ...VALID };
    delete rest.id;
    expect(() => parsePayload(JSON.stringify(rest))).toThrow();
  });

  it('throws on an unknown source', () => {
    expect(() => parsePayload(JSON.stringify({ ...VALID, source: 'carrier-pigeon' }))).toThrow();
  });

  it('throws on an unknown category', () => {
    expect(() => parsePayload(JSON.stringify({ ...VALID, category: 'praise' }))).toThrow();
  });

  it('throws when message is empty', () => {
    expect(() => parsePayload(JSON.stringify({ ...VALID, message: '' }))).toThrow();
  });

  it('throws when createdAt is missing', () => {
    const rest: Partial<typeof VALID> = { ...VALID };
    delete rest.createdAt;
    expect(() => parsePayload(JSON.stringify(rest))).toThrow();
  });
});
