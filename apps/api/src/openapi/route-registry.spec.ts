/**
 * The assertions that make the published document safe to publish.
 *
 * `check:openapi` runs the same comparisons in CI over the committed
 * artifacts. These run them in the test suite too, so a route added with no
 * registry entry, no validation pipe, a swapped schema, a wrong auth marking
 * or a wrong rate limit marking fails locally on `npm test` rather than
 * waiting for the check step.
 */
import { resolve } from 'node:path';
import * as shared from '@portfolio/shared';
import { buildDocument, pathPlaceholders, tagFor } from './document';
import { registeredControllers, routeKey, scanControllers } from './controller-scan';
import { ROUTES } from './route-registry';
import type { RouteEntry } from './types';

const SOURCE_DIR = resolve(__dirname, '..');
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');

const scan = scanControllers(SOURCE_DIR, REPO_ROOT);
const registered = registeredControllers(SOURCE_DIR);
const live = scan.routes.filter((route) => registered.has(route.className));

describe('the registry against the controllers', () => {
  it('reads every file it walks without hitting something it cannot interpret', () => {
    expect(scan.problems).toEqual([]);
  });

  it('finds the controllers at all', () => {
    // Guards the rest of this file: a broken path would make every
    // comparison below pass over an empty list and prove nothing.
    expect(live.length).toBeGreaterThan(0);
  });

  it('finds every controller class through a module registration', () => {
    const unregistered = scan.routes
      .filter((route) => !registered.has(route.className))
      .map((route) => route.className);
    expect([...new Set(unregistered)]).toEqual([]);
  });

  it('describes exactly the routes the controllers serve', () => {
    expect(ROUTES.map(routeKey).sort()).toEqual(live.map(routeKey).sort());
  });

  it('agrees with every anonymous marking', () => {
    const registryAuth = new Map(ROUTES.map((e) => [routeKey(e), e.anonymous]));
    const disagreements = live
      .filter((route) => registryAuth.get(routeKey(route)) !== route.anonymous)
      .map(routeKey);
    expect(disagreements).toEqual([]);
  });

  it('leaves no handler binding input without a ZodValidationPipe', () => {
    const unvalidated = live.flatMap((route) =>
      route.bindings.filter((b) => !b.validated).map((b) => `${route.handler} @${b.kind}()`),
    );
    expect(unvalidated).toEqual([]);
  });

  it('publishes the same schema the pipe actually enforces', () => {
    const field = { Body: 'requestSchema', Param: 'paramSchema', Query: 'querySchema' } as const;
    const byKey = new Map(ROUTES.map((e) => [routeKey(e), e]));
    const exports = shared as unknown as Record<string, unknown>;
    const mismatches: string[] = [];

    for (const route of live) {
      const entry = byKey.get(routeKey(route));
      if (!entry) continue;
      for (const binding of route.bindings) {
        const key = field[binding.kind as keyof typeof field];
        if (!key || !binding.schemaName) continue;
        if (exports[binding.schemaName] !== (entry as RouteEntry)[key]) {
          mismatches.push(`${route.handler} @${binding.kind}() ${binding.schemaName}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('documents a 429 on exactly the routes the code rate limits', () => {
    const byKey = new Map(ROUTES.map((e) => [routeKey(e), e]));
    const wrong = live
      .filter((route) => {
        const entry = byKey.get(routeKey(route));
        if (!entry) return false;
        return entry.responses.some((r) => r.status === 429) !== route.throttled;
      })
      .map(routeKey);
    expect(wrong).toEqual([]);
  });

  it('marks four routes as needing a session and the rest as anonymous', () => {
    expect(ROUTES.filter((e) => !e.anonymous).map(routeKey).sort()).toEqual([
      'GET /internal/grade-photos',
      'GET /internal/usage/summary',
      'PATCH /internal/grade-photos/{id}/active',
      'POST /internal/grade-photos',
    ]);
  });
});

describe('the generated document', () => {
  const document = buildDocument();
  const serialized = JSON.stringify(document);

  it('publishes no servers block and no api origin', () => {
    expect(document).not.toHaveProperty('servers');
    expect(serialized).not.toMatch(/onrender\.com|vercel\.app|https?:\/\/(?!json-schema\.org)/);
  });

  it('copies no numeric rate limit or window into the document', () => {
    expect(serialized).not.toMatch(/\d+\s*(requests?|per (hour|minute|day))/i);
    expect(document.info.description).not.toMatch(/\b\d+\s*(per|\/)\s*(hour|minute|day)\b/i);
  });

  it('claims a limit only where a 429 says so', () => {
    // The prose used to say "every public route is limited per client", which
    // was false for the four static reads. It now points at the 429s, and the
    // check compares each of those against the controllers.
    expect(document.info.description).not.toMatch(/every public route is limited/i);
  });

  it('generates every request body with additionalProperties false', () => {
    const bodies = ROUTES.filter((e) => e.requestSchema).map((e) => {
      const operation = document.paths[e.path][e.method] as {
        requestBody: { content: Record<string, { schema: Record<string, unknown> }> };
      };
      return Object.values(operation.requestBody.content)[0].schema;
    });
    expect(bodies).toHaveLength(6);
    for (const schema of bodies) expect(schema.additionalProperties).toBe(false);
  });

  it('declares a parameter for every path placeholder', () => {
    for (const entry of ROUTES) {
      const operation = document.paths[entry.path][entry.method] as {
        parameters?: { name: string; in: string }[];
      };
      const path = (operation.parameters ?? []).filter((p) => p.in === 'path').map((p) => p.name);
      expect(path).toEqual(pathPlaceholders(entry.path));
    }
  });

  it('documents a 400 on every route that validates input', () => {
    for (const entry of ROUTES) {
      if (!entry.requestSchema && !entry.paramSchema && !entry.querySchema) continue;
      const operation = document.paths[entry.path][entry.method] as {
        responses: Record<string, unknown>;
      };
      expect(Object.keys(operation.responses)).toContain('400');
    }
  });

  it('documents both streaming routes as text/event-stream', () => {
    for (const path of ['/conversation/turn', '/beta/plan']) {
      const operation = document.paths[path].post as {
        responses: Record<string, { content?: Record<string, unknown> }>;
      };
      expect(Object.keys(operation.responses['200'].content ?? {})).toEqual(['text/event-stream']);
    }
  });

  it('marks the three grade routes as conditional on GRADE_GAME_ENABLED', () => {
    const conditional = ROUTES.filter((e) => e.conditionalOn === 'GRADE_GAME_ENABLED').map(routeKey);
    expect(conditional.sort()).toEqual([
      'GET /grade/problems',
      'GET /grade/problems/{publicId}/image',
      'POST /grade/guess',
    ]);
  });

  it('gives every operation a unique operationId', () => {
    const ids = Object.values(document.paths).flatMap((methods) =>
      Object.values(methods).map((op) => (op as { operationId: string }).operationId),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('refuses to build a document whose operationIds collide', () => {
    // /internal/grade-photos and /internal/grade/photos both flatten to
    // get-internal-grade-photos, which is an invalid document and two index
    // links pointing at one section.
    const clashing: RouteEntry[] = [
      { method: 'get', path: '/internal/grade-photos', anonymous: false, summary: 'a', responses: [] },
      { method: 'get', path: '/internal/grade/photos', anonymous: false, summary: 'b', responses: [] },
    ];
    expect(() => buildDocument(clashing)).toThrow(/same operationId/);
  });

  it('is byte identical when built twice', () => {
    expect(JSON.stringify(buildDocument())).toBe(serialized);
  });
});

describe('tagFor', () => {
  it('groups each known prefix', () => {
    expect(tagFor('/')).toBe('service');
    expect(tagFor('/health')).toBe('service');
    expect(tagFor('/stories')).toBe('content');
    expect(tagFor('/beta/plan')).toBe('beta');
    expect(tagFor('/internal/usage/summary')).toBe('internal');
  });

  it('refuses an unknown prefix rather than calling it the admin surface', () => {
    // The old fall-through returned 'internal', so a new public route would
    // have been published under "The admin surface, behind a better-auth
    // session" — wrong, and in a file anyone can read.
    expect(() => tagFor('/metrics')).toThrow(/No tag for path/);
    expect(() => tagFor('/webhooks/stripe')).toThrow(/No tag for path/);
  });
});
