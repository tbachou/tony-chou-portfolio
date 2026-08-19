import { hashIp, rateLimitIdentity } from './ip-hash.util';

describe('rateLimitIdentity', () => {
  it('passes a plain IPv4 address through unchanged', () => {
    expect(rateLimitIdentity('203.0.113.7')).toBe('203.0.113.7');
  });

  it('unwraps an IPv4-mapped IPv6 address to the bare IPv4', () => {
    expect(rateLimitIdentity('::ffff:203.0.113.7')).toBe('203.0.113.7');
  });

  it('collapses a full IPv6 address to its /64 prefix', () => {
    expect(
      rateLimitIdentity('2001:db8:aaaa:bbbb:cccc:dddd:eeee:ffff'),
    ).toBe('2001:db8:aaaa:bbbb::/64');
  });

  it('collapses a compressed IPv6 address to its /64 prefix', () => {
    expect(rateLimitIdentity('2001:db8::1')).toBe('2001:db8:0:0::/64');
  });

  it('maps two addresses in the same /64 to the same identity', () => {
    expect(rateLimitIdentity('2001:db8:aaaa:bbbb::1')).toBe(
      rateLimitIdentity('2001:db8:aaaa:bbbb:ffff:eeee:dddd:2'),
    );
  });

  it('maps addresses in different /64s to different identities', () => {
    expect(rateLimitIdentity('2001:db8:aaaa:bbbb::1')).not.toBe(
      rateLimitIdentity('2001:db8:aaaa:cccc::1'),
    );
  });
});

describe('hashIp', () => {
  const originalSalt = process.env.IP_HASH_SALT;

  afterEach(() => {
    if (originalSalt === undefined) {
      delete process.env.IP_HASH_SALT;
    } else {
      process.env.IP_HASH_SALT = originalSalt;
    }
  });

  it('produces a stable 64-char hex digest for the same input and salt', () => {
    process.env.IP_HASH_SALT = 'test-salt';
    const first = hashIp('203.0.113.7');
    const second = hashIp('203.0.113.7');
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes the digest when the input changes', () => {
    process.env.IP_HASH_SALT = 'test-salt';
    expect(hashIp('203.0.113.7')).not.toBe(hashIp('203.0.113.8'));
  });

  it('changes the digest when the salt changes', () => {
    process.env.IP_HASH_SALT = 'salt-one';
    const one = hashIp('203.0.113.7');
    process.env.IP_HASH_SALT = 'salt-two';
    expect(hashIp('203.0.113.7')).not.toBe(one);
  });

  it('throws when IP_HASH_SALT is not configured', () => {
    delete process.env.IP_HASH_SALT;
    expect(() => hashIp('203.0.113.7')).toThrow('IP_HASH_SALT');
  });
});
