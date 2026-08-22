import {
  DEFAULT_ALLOWED_ORIGIN,
  resolveAllowedOrigins,
} from './allowed-origins.util';

describe('resolveAllowedOrigins', () => {
  const original = process.env.CORS_ORIGIN;

  afterEach(() => {
    if (original === undefined) delete process.env.CORS_ORIGIN;
    else process.env.CORS_ORIGIN = original;
  });

  it('falls back to localhost when CORS_ORIGIN is unset', () => {
    delete process.env.CORS_ORIGIN;
    expect(resolveAllowedOrigins()).toEqual([DEFAULT_ALLOWED_ORIGIN]);
  });

  it('splits a comma separated list', () => {
    process.env.CORS_ORIGIN = 'https://a.example,https://b.example';
    expect(resolveAllowedOrigins()).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
  });

  it('trims entries, so a spaced list still matches a real Origin header', () => {
    process.env.CORS_ORIGIN = 'https://a.example, https://b.example';
    expect(resolveAllowedOrigins()).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
  });

  it('drops empty entries from a trailing or doubled comma', () => {
    process.env.CORS_ORIGIN = 'https://a.example,,';
    expect(resolveAllowedOrigins()).toEqual(['https://a.example']);
  });

  it('returns an empty list for an empty value rather than the default', () => {
    // An explicitly empty CORS_ORIGIN is a deployment choice, not an absent
    // one, so it must not silently re-admit localhost.
    process.env.CORS_ORIGIN = '';
    expect(resolveAllowedOrigins()).toEqual([]);
  });
});
