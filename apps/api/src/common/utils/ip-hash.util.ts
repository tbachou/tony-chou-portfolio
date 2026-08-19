import { createHmac } from 'crypto';
import type { Request } from 'express';

export function resolveClientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

export function hashIp(ip: string): string {
  const salt = process.env.IP_HASH_SALT;
  if (!salt) {
    throw new Error('IP_HASH_SALT is not configured');
  }
  return createHmac('sha256', salt).update(ip).digest('hex');
}

/**
 * Rate-limit identity for an IP: IPv4 stands alone; IPv6 collapses to its
 * /64 prefix, because one ordinary home allocation hands out 2^64 addresses
 * and per-address limits are free to rotate past (Beta security audit).
 */
export function rateLimitIdentity(ip: string): string {
  const unmapped = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (!unmapped.includes(':')) return unmapped;
  return `${expandIpv6(unmapped).slice(0, 4).join(':')}::/64`;
}

function expandIpv6(ip: string): string[] {
  const [head, tail = ''] = ip.split('::');
  const headParts = head ? head.split(':') : [];
  const tailParts = tail ? tail.split(':') : [];
  const missing = 8 - headParts.length - tailParts.length;
  return [
    ...headParts,
    ...(Array(Math.max(missing, 0)).fill('0') as string[]),
    ...tailParts,
  ];
}
