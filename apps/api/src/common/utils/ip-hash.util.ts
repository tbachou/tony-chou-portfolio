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
