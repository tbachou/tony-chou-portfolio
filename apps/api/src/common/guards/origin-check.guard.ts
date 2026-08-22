import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { resolveAllowedOrigins } from '../utils/allowed-origins.util';

/** The methods that change state, and so are worth forging. */
const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Rejects a state-changing request whose `Origin` is not one we allow.
 *
 * This is the CSRF defence, and `enableCors` is not it. CORS only ends the
 * response early for a preflight (`OPTIONS`); for any other method the cors
 * middleware sets headers and calls `next()`, so a disallowed origin still
 * reaches the handler and only the *response* is opaque to the attacker. That
 * is fine for a read and useless for a write.
 *
 * It matters here because the session cookie is `SameSite=None` in production
 * (apps/api/src/lib/auth.ts explains why: apps/web and apps/api are separate
 * origins, and a Lax cookie never reaches the cross-origin session check), so
 * browsers attach it to cross-site requests. A `multipart/form-data` POST is
 * CORS-safelisted, so it is a "simple" request that triggers no preflight at
 * all: the admin photo upload was reachable from any page the signed-in owner
 * happened to visit. better-auth's own origin check does not cover this, being
 * router middleware scoped to its `/api/auth` routes rather than to the app's.
 *
 * A missing `Origin` is allowed deliberately. Browsers always send it on
 * cross-origin requests and on same-origin state-changing ones, and an
 * attacker's page cannot suppress it, so absence means a non-browser caller
 * (curl, a health probe, server to server) which is not a CSRF vector.
 * Rejecting those instead would break tooling while buying no safety.
 */
@Injectable()
export class OriginCheckGuard implements CanActivate {
  private readonly logger = new Logger(OriginCheckGuard.name);

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const request = context.switchToHttp().getRequest<{
      method?: string;
      url?: string;
      headers?: Record<string, unknown>;
    }>();

    const method = (request?.method ?? 'GET').toUpperCase();
    if (!STATE_CHANGING_METHODS.has(method)) return true;

    const origin = request?.headers?.origin;
    if (typeof origin !== 'string' || origin === '') return true;

    if (resolveAllowedOrigins().includes(origin)) return true;

    // Guards run before interceptors, so LoggingInterceptor never sees a
    // rejected request and a 403 would otherwise leave no trace at all. If a
    // CORS_ORIGIN edit ever started refusing real traffic, the symptom would
    // be requests silently ceasing to arrive with nothing to correlate.
    //
    // The origin is not logged: it is the attacker's own string and adds
    // nothing an operator needs. The URL is, and it IS caller-chosen, so it
    // goes through JSON.stringify exactly as LoggingInterceptor does with the
    // same field. Today that is belt and braces (a raw CR, LF or ESC in a
    // request target is rejected by the HTTP parser before any of this runs,
    // and a percent-encoded one is never decoded here), but the escaping is
    // what keeps it true if this ever reads a decoded path instead.
    this.logger.warn(
      `Rejected cross-origin ${method} ${JSON.stringify(request?.url ?? '')}`,
    );

    // The origin is not echoed back either: it is attacker-chosen, and the
    // caller already knows what it sent.
    throw new ForbiddenException('Cross-origin request rejected');
  }
}
