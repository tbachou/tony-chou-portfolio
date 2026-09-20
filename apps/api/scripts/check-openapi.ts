/**
 * Fails the build when the published API document stops matching the code
 * (spec 0016).
 *
 *   npm run check:openapi --workspace=apps/api
 *
 * The assertions, in the order a failure is cheapest to understand:
 *
 *   0. The scan read every file confidently. Anything it could not read is a
 *      failure, never a silent default, because a route it cannot see is
 *      missing from the registry too and so produces no mismatch.
 *   1. Every controller class some module registers, and no other, is in the
 *      registry, with the same auth marking (AC-8). The auth half matters
 *      most: this repository is public, so a route wrongly marked anonymous
 *      is a false security claim anyone can read.
 *   2. No handler binds `@Body`, `@Param` or `@Query` without a
 *      `ZodValidationPipe` (AC-10). `main.ts` drops the global pipe and names
 *      the resulting hole as the price; this closes it.
 *   3. The schema the document publishes is the schema the pipe actually
 *      holds, compared by identity through `@portfolio/shared`.
 *   4. A route documents a 429 exactly when its code is rate limited, so the
 *      document's prose about limiting cannot drift from the controllers.
 *   5. Both committed artifacts match a fresh generation (AC-9).
 *
 * It reads committed files only: no network, no database, no environment
 * variable, so it runs on a fork pull request like every other step in the
 * `verify` job (AC-11).
 *
 * This file is a thin wrapper. The logic it calls lives in `src/openapi/`, so
 * jest can collect its tests (`rootDir` is `src`).
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as shared from '@portfolio/shared';
import { renderArtifacts } from '../src/openapi/artifacts';
import {
  registeredControllers,
  routeKey,
  scanControllers,
  type ScanResult,
  type ScannedRoute,
} from '../src/openapi/controller-scan';
import { ROUTES } from '../src/openapi/route-registry';
import type { RouteEntry } from '../src/openapi/types';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const SOURCE_DIR = resolve(__dirname, '..', 'src');

/** Which registry field a binding of each kind must agree with. */
const SCHEMA_FIELD = {
  Body: 'requestSchema',
  Param: 'paramSchema',
  Query: 'querySchema',
} as const satisfies Record<string, keyof RouteEntry>;

function fail(lines: string[]): never {
  console.error('check:openapi FAILED');
  for (const line of lines) console.error(`  ${line}`);
  console.error('');
  console.error(
    '  Fix the registry at apps/api/src/openapi/route-registry.ts, or the controller,',
  );
  console.error(
    '  then run: npm run build:openapi --workspace=apps/api  and commit docs/api/.',
  );
  process.exit(1);
}

/** A controller class no module lists is not a live route, and must not be published. */
function checkRegistration(scan: ScanResult): { problems: string[]; live: ScannedRoute[] } {
  const registered = registeredControllers(SOURCE_DIR);
  const problems: string[] = [];
  const live: ScannedRoute[] = [];
  const reported = new Set<string>();

  for (const route of scan.routes) {
    if (registered.has(route.className)) {
      live.push(route);
      continue;
    }
    if (reported.has(route.className)) continue;
    reported.add(route.className);
    problems.push(
      `${route.className} (${route.file}) carries @Controller() but no module lists it in controllers: []. NestJS never mounts it, so its routes are not live. Register it, or delete it, rather than leaving a class that reads like a route surface.`,
    );
  }
  return { problems, live };
}

function checkRoutesAndAuth(live: ScannedRoute[]): string[] {
  const problems: string[] = [];
  const scannedByKey = new Map(live.map((route) => [routeKey(route), route]));
  const registryByKey = new Map(ROUTES.map((entry) => [routeKey(entry), entry]));

  if (scannedByKey.size !== live.length) {
    const seen = new Set<string>();
    for (const route of live) {
      const key = routeKey(route);
      if (seen.has(key)) problems.push(`${key} is served by more than one handler`);
      seen.add(key);
    }
  }

  for (const [key, route] of scannedByKey) {
    if (!registryByKey.has(key)) {
      problems.push(`${key} is served by ${route.handler} (${route.file}) but is not in the registry`);
    }
  }
  for (const key of registryByKey.keys()) {
    if (!scannedByKey.has(key)) {
      problems.push(`${key} is in the registry but no controller serves it`);
    }
  }

  for (const [key, route] of scannedByKey) {
    const entry = registryByKey.get(key);
    if (!entry || entry.anonymous === route.anonymous) continue;
    problems.push(
      entry.anonymous
        ? `${key} is marked anonymous in the registry, but ${route.handler} carries no decorator that lets a request through without a session`
        : `${key} is marked as requiring a session in the registry, but ${route.handler} is reachable without one`,
    );
  }

  return problems;
}

function checkValidationPipes(live: ScannedRoute[]): string[] {
  return live.flatMap((route) =>
    route.bindings
      .filter((binding) => !binding.validated)
      .map(
        (binding) =>
          `${route.handler} (${route.file}) binds @${binding.kind}() with no ZodValidationPipe, so ${routeKey(route)} validates nothing`,
      ),
  );
}

/**
 * The document's headline claim is that a published request shape is the shape
 * that validates. Nothing checked it: swapping one schema for another in the
 * registry published a completely different body with the check still green.
 */
function checkSchemasMatch(live: ScannedRoute[]): string[] {
  const problems: string[] = [];
  const registryByKey = new Map(ROUTES.map((entry) => [routeKey(entry), entry]));
  const exports = shared as unknown as Record<string, unknown>;

  for (const route of live) {
    const key = routeKey(route);
    const entry = registryByKey.get(key);
    if (!entry) continue;

    for (const kind of ['Body', 'Param', 'Query'] as const) {
      const field = SCHEMA_FIELD[kind];
      const documented = entry[field];
      const binding = route.bindings.find((candidate) => candidate.kind === kind);

      if (!binding) {
        if (documented) {
          problems.push(
            `${key} documents a ${field}, but ${route.handler} binds no @${kind}()`,
          );
        }
        continue;
      }
      if (!binding.validated) continue;

      if (!documented) {
        problems.push(
          `${route.handler} validates @${kind}() with ${binding.schemaName ?? 'a schema'}, but ${key} documents no ${field}`,
        );
        continue;
      }
      if (!binding.schemaName) {
        problems.push(
          `${route.handler}'s @${kind}() pipe was not given a named schema, so ${key}'s published ${field} cannot be checked against it`,
        );
        continue;
      }
      const enforced = exports[binding.schemaName];
      if (enforced === undefined) {
        problems.push(
          `${route.handler}'s @${kind}() uses ${binding.schemaName}, which is not a named export of @portfolio/shared, so ${key}'s published ${field} cannot be checked against it`,
        );
        continue;
      }
      if (enforced !== documented) {
        problems.push(
          `${key} publishes a different ${field} than the code enforces: ${route.handler} validates with ${binding.schemaName}`,
        );
      }
    }
  }
  return problems;
}

/** The document says a 429 means limited. This is what keeps that true. */
function checkRateLimitMarkings(live: ScannedRoute[]): string[] {
  const problems: string[] = [];
  const registryByKey = new Map(ROUTES.map((entry) => [routeKey(entry), entry]));

  for (const route of live) {
    const key = routeKey(route);
    const entry = registryByKey.get(key);
    if (!entry) continue;
    const documents429 = entry.responses.some((response) => response.status === 429);
    if (documents429 === route.throttled) continue;
    problems.push(
      route.throttled
        ? `${key} is rate limited in ${route.handler} but documents no 429 response`
        : `${key} documents a 429 response but ${route.handler} carries no throttle, so the document claims a limit the code does not apply`,
    );
  }
  return problems;
}

function checkArtifacts(): string[] {
  const problems: string[] = [];
  for (const { path, contents } of renderArtifacts()) {
    let committed: string;
    try {
      committed = readFileSync(join(REPO_ROOT, path), 'utf8');
    } catch {
      problems.push(`${path} is missing`);
      continue;
    }
    if (committed !== contents) {
      problems.push(`${path} differs from a fresh generation`);
    }
  }
  return problems;
}

function main(): void {
  // Scanned once, then handed to every assertion below.
  const scan = scanControllers(SOURCE_DIR, REPO_ROOT);
  if (scan.problems.length > 0) {
    fail(scan.problems.map((problem) => `${problem.file}: ${problem.message}`));
  }

  const { problems: registration, live } = checkRegistration(scan);
  const problems = [
    ...registration,
    ...checkRoutesAndAuth(live),
    ...checkValidationPipes(live),
    ...checkSchemasMatch(live),
    ...checkRateLimitMarkings(live),
    ...checkArtifacts(),
  ];
  if (problems.length > 0) fail(problems);
  console.log(
    `check:openapi OK — ${ROUTES.length} routes across ${new Set(live.map((r) => r.className)).size} registered controllers; registry, schemas, limits and artifacts all match the code`,
  );
}

main();
