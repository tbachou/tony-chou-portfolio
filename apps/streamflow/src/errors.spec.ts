import { sanitizeError } from './errors';

describe('sanitizeError', () => {
  it('keeps an ordinary message', () => {
    expect(sanitizeError(new Error('USGS request failed with 503'))).toBe(
      'USGS request failed with 503',
    );
  });

  it('strips a postgres connection string out of a driver error', () => {
    const message = sanitizeError(
      new Error(
        "can't reach postgresql://pipeline:hunter2@db.example.com:5432/streamflow at port 5432",
      ),
    );

    expect(message).not.toContain('hunter2');
    expect(message).not.toContain('db.example.com');
    expect(message).toContain('[redacted connection string]');
  });

  it('strips a prisma scheme url too', () => {
    const message = sanitizeError(
      new Error('failed on prisma://accelerate.example.com/?api_key=secret'),
    );

    expect(message).not.toContain('secret');
  });

  it('strips a bare api key with no url around it', () => {
    const message = sanitizeError(
      new Error('authentication failed: token sk_FAKEKEY1234567 rejected'),
    );

    expect(message).not.toContain('sk_FAKEKEY1234567');
    expect(message).toContain('[redacted key]');
  });

  it('strips credentials quoted without a scheme', () => {
    const message = sanitizeError(
      new Error('auth failed for abc123:sk_FAKEKEY1234567 at pooled.db.prisma.io'),
    );

    expect(message).not.toContain('sk_FAKEKEY1234567');
  });

  it('leaves ordinary words that merely start with sk alone', () => {
    expect(sanitizeError(new Error('skipped 4 chunks'))).toBe('skipped 4 chunks');
  });

  it('caps a very long message', () => {
    const message = sanitizeError(new Error('x'.repeat(2000)));

    expect(message.length).toBeLessThanOrEqual(503);
    expect(message.endsWith('...')).toBe(true);
  });

  it('handles a thrown string', () => {
    expect(sanitizeError('plain failure')).toBe('plain failure');
  });

  it('handles a thrown value that is neither', () => {
    expect(sanitizeError({ odd: true })).toBe('unknown error');
  });
});
