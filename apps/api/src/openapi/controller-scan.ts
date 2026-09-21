/**
 * Reads the controllers and reports what they actually serve (spec 0016).
 *
 * This is what turns the route registry from an unguarded duplicate into a
 * guarded one. `check:openapi` compares this against the registry and fails on
 * disagreement: a route in one and not the other, an auth marking that differs,
 * a handler that binds input with no validation pipe, a pipe holding a
 * different schema than the document publishes, and a rate limiting marking
 * that does not match the code (AC-8, AC-10).
 *
 * It parses with the TypeScript compiler rather than matching text. The
 * controllers carry long comment blocks that discuss decorators by name, and a
 * regular expression would read `@Body(` inside a comment as a real binding.
 * A check whose answer can be changed by editing a comment is not a check.
 *
 * It reads committed files only: no import of the application, no boot, no
 * database, no environment variable (AC-11). That is also why it cannot be
 * fooled into skipping `GradeModule`, which is registered conditionally.
 *
 * **Everything here fails LOUD, never open.** An adversarial pass against the
 * first version of this file shipped four live routes that it reported as
 * clean, and every one was a case the scan could not see rather than one it
 * judged wrongly: a file not named `*.controller.ts`, a handler inherited from
 * a base class, a class nested in a block, and an import renamed on the way in.
 * Invisibility is the failure mode, because a route missing from the scan is
 * also missing from the registry, so it produces no mismatch. Hence: every
 * `.ts` under `src` is parsed, classes are found at any depth, identifiers are
 * resolved back through their imports, and anything this file cannot read
 * confidently becomes a `problem` that fails the check instead of a silent
 * default.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import * as ts from 'typescript';

/** The decorators AC-10 cares about. `@Req`, `@Res` and `@UploadedFile` carry no schema. */
const INPUT_DECORATORS = new Set(['Body', 'Param', 'Query']);

const METHOD_DECORATORS = new Set(['Get', 'Post', 'Patch', 'Put', 'Delete']);

const NEST_MODULE = '@nestjs/common';
const BETTER_AUTH_MODULE = '@thallesp/nestjs-better-auth';

/**
 * Every better-auth decorator that lets a request through with no session.
 * `Public` is a direct alias of `AllowAnonymous`, and `OptionalAuth`/`Optional`
 * make the guard return true when there is no session at all. Matching only
 * `AllowAnonymous` published "session required" for routes anyone could call.
 */
const EXEMPTION_DECORATORS = new Set([
  'AllowAnonymous',
  'Public',
  'OptionalAuth',
  'Optional',
]);

/** better-auth decorators that are known NOT to grant anonymous access. */
const KNOWN_BETTER_AUTH_DECORATORS = new Set([
  ...EXEMPTION_DECORATORS,
  'Roles',
  'OrgRoles',
  'Session',
  'AfterHook',
  'BeforeHook',
  'Hook',
]);

const PIPE_CLASS = 'ZodValidationPipe';
/** The pipe is identified by where it comes from, not only by what it is called. */
const PIPE_MODULE_SUFFIX = 'zod-validation.pipe';
/**
 * ESM specifiers carry a `.js` extension that points at a `.ts` source file,
 * so the suffix match has to ignore it. Without this the scanner silently
 * reports every validated binding as unvalidated, which would publish a false
 * "no validation" claim in `docs/api/` rather than fail loudly.
 */
const withoutJsExtension = (module: string): string => module.replace(/\.js$/, '');

export type ScannedBinding = {
  kind: string;
  /** False when the binding names no `new ZodValidationPipe(...)` from the real pipe module. */
  validated: boolean;
  /** The identifier the pipe was constructed with, so the registry can be checked against it. */
  schemaName?: string;
};

export type ScannedRoute = {
  method: string;
  /** OpenAPI form, so it can be compared to the registry directly. */
  path: string;
  anonymous: boolean;
  /** Carries `@Throttle` or a `*ThrottlerGuard`, on the handler or the class. */
  throttled: boolean;
  /** `GradeController.problemImage`, for naming the offender in a failure. */
  handler: string;
  className: string;
  file: string;
  bindings: ScannedBinding[];
};

/** Something the scan could not read confidently. Every one fails the check. */
export type ScanProblem = { file: string; message: string };

export type ScanResult = { routes: ScannedRoute[]; problems: ScanProblem[] };

type Imported = { original: string; module: string };

function decoratorsOf(node: ts.Node): ts.Decorator[] {
  return ts.canHaveDecorators(node) ? [...(ts.getDecorators(node) ?? [])] : [];
}

/**
 * Local identifier to the name it was imported under.
 *
 * This is what defeats renaming. `import { Body as ReqBody }` used to make a
 * binding disappear, and `import { SomeOtherPipe as ZodValidationPipe }` used
 * to make an unrelated pipe count as validation.
 */
function collectImports(source: ts.SourceFile): Map<string, Imported> {
  const imports = new Map<string, Imported>();
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      const module = node.moduleSpecifier.text;
      const named = node.importClause?.namedBindings;
      if (named && ts.isNamedImports(named)) {
        for (const element of named.elements) {
          imports.set(element.name.text, {
            original: (element.propertyName ?? element.name).text,
            module,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return imports;
}

type DecoratorRef = { name: string; module?: string };

/** The decorator's ORIGINAL name plus where it came from, seeing through any alias. */
function decoratorRef(
  decorator: ts.Decorator,
  imports: Map<string, Imported>,
): DecoratorRef | undefined {
  const expression = ts.isCallExpression(decorator.expression)
    ? decorator.expression.expression
    : decorator.expression;
  if (!ts.isIdentifier(expression)) return undefined;
  const imported = imports.get(expression.text);
  return imported
    ? { name: imported.original, module: imported.module }
    : { name: expression.text };
}

function findDecorator(
  node: ts.Node,
  imports: Map<string, Imported>,
  predicate: (ref: DecoratorRef) => boolean,
): ts.Decorator | undefined {
  return decoratorsOf(node).find((decorator) => {
    const ref = decoratorRef(decorator, imports);
    return ref !== undefined && predicate(ref);
  });
}

/** A decorator from `@nestjs/common`, or declared locally under that exact name. */
function isNest(ref: DecoratorRef, name: string): boolean {
  return ref.name === name && (ref.module === undefined || ref.module === NEST_MODULE);
}

type PathArgument = { value?: string; unreadable?: boolean };

/**
 * The path a route decorator declares.
 *
 * Anything that is not a plain string literal is `unreadable` rather than an
 * empty default. `@Controller({ path: 'health' })` and `@Get(['a', 'b'])` used
 * to silently drop the prefix, and the mismatch that followed reported "two
 * controller handlers serve the same method and path", which sent the reader
 * off to edit the registry and publish a path that does not exist.
 */
function pathArgument(decorator: ts.Decorator): PathArgument {
  if (!ts.isCallExpression(decorator.expression)) return {};
  const [argument] = decorator.expression.arguments;
  if (!argument) return {};
  if (ts.isStringLiteralLike(argument)) return { value: argument.text };
  return { unreadable: true };
}

/**
 * `grade` + `problems/:publicId/image` -> `/grade/problems/{publicId}/image`.
 * An empty prefix and an empty sub path give `/`, the root controller's route.
 */
export function joinRoutePath(prefix: string, subPath: string): string {
  const segments = [...prefix.split('/'), ...subPath.split('/')]
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => (segment.startsWith(':') ? `{${segment.slice(1)}}` : segment));
  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

function isThrottled(node: ts.Node, imports: Map<string, Imported>): boolean {
  for (const decorator of decoratorsOf(node)) {
    const ref = decoratorRef(decorator, imports);
    if (!ref) continue;
    if (ref.name === 'Throttle') return true;
    if (ref.name === 'UseGuards' && ts.isCallExpression(decorator.expression)) {
      for (const argument of decorator.expression.arguments) {
        if (!ts.isIdentifier(argument)) continue;
        const resolved = imports.get(argument.text)?.original ?? argument.text;
        if (resolved.endsWith('ThrottlerGuard')) return true;
      }
    }
  }
  return false;
}

/** True when any better-auth decorator here lets a request through with no session. */
function readsAsAnonymous(
  node: ts.Node,
  imports: Map<string, Imported>,
  where: string,
  file: string,
  problems: ScanProblem[],
): boolean {
  let anonymous = false;
  for (const decorator of decoratorsOf(node)) {
    const ref = decoratorRef(decorator, imports);
    if (!ref || ref.module !== BETTER_AUTH_MODULE) continue;
    if (EXEMPTION_DECORATORS.has(ref.name)) {
      anonymous = true;
      continue;
    }
    if (!KNOWN_BETTER_AUTH_DECORATORS.has(ref.name)) {
      problems.push({
        file,
        message: `${where} carries @${ref.name}() from ${BETTER_AUTH_MODULE}, which this scan does not recognise. If that decorator can let a request through without a session, the published auth marking would be a false security claim. Add it to EXEMPTION_DECORATORS or KNOWN_BETTER_AUTH_DECORATORS in controller-scan.ts.`,
      });
    }
  }
  return anonymous;
}

function bindingsOf(
  method: ts.MethodDeclaration,
  imports: Map<string, Imported>,
): ScannedBinding[] {
  const bindings: ScannedBinding[] = [];
  for (const parameter of method.parameters) {
    for (const decorator of decoratorsOf(parameter)) {
      const ref = decoratorRef(decorator, imports);
      if (!ref || !INPUT_DECORATORS.has(ref.name)) continue;
      if (ref.module !== undefined && ref.module !== NEST_MODULE) continue;

      let validated = false;
      let schemaName: string | undefined;
      if (ts.isCallExpression(decorator.expression)) {
        for (const argument of decorator.expression.arguments) {
          if (!ts.isNewExpression(argument) || !ts.isIdentifier(argument.expression)) continue;
          const constructor = imports.get(argument.expression.text);
          const isRealPipe = constructor
            ? constructor.original === PIPE_CLASS &&
              withoutJsExtension(constructor.module).endsWith(PIPE_MODULE_SUFFIX)
            : argument.expression.text === PIPE_CLASS;
          if (!isRealPipe) continue;
          validated = true;
          const [schemaArgument] = argument.arguments ?? [];
          if (schemaArgument && ts.isIdentifier(schemaArgument)) {
            schemaName = schemaArgument.text;
          }
        }
      }
      bindings.push(schemaName ? { kind: ref.name, validated, schemaName } : { kind: ref.name, validated });
    }
  }
  return bindings;
}

/** Every class in the file, at any depth: a block, a namespace, a conditional export. */
function collectClasses(source: ts.SourceFile): ts.ClassDeclaration[] {
  const classes: ts.ClassDeclaration[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node)) classes.push(node);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return classes;
}

function baseClassName(declaration: ts.ClassDeclaration): string | undefined {
  for (const clause of declaration.heritageClauses ?? []) {
    if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue;
    const [type] = clause.types;
    if (type && ts.isIdentifier(type.expression)) return type.expression.text;
    return '(an expression this scan cannot read)';
  }
  return undefined;
}

/**
 * A controller's own members plus everything it inherits.
 *
 * NestJS mounts routes declared on a base class, because its metadata scanner
 * walks the prototype chain. A base class this file cannot resolve is a
 * problem rather than an empty result: the routes exist, and reporting none is
 * how an inherited unvalidated handler shipped with the check green.
 */
function membersOf(
  declaration: ts.ClassDeclaration,
  classesByName: Map<string, ts.ClassDeclaration>,
  file: string,
  problems: ScanProblem[],
  seen = new Set<string>(),
): ts.ClassElement[] {
  const members = [...declaration.members];
  const base = baseClassName(declaration);
  if (!base || seen.has(base)) return members;
  seen.add(base);

  const baseDeclaration = classesByName.get(base);
  if (!baseDeclaration) {
    problems.push({
      file,
      message: `${declaration.name?.text ?? 'a controller'} extends ${base}, which this scan cannot resolve in this file. NestJS serves routes declared on a base class, so any route there would be live and undocumented. Move the handlers into the controller, or declare the base in the same file.`,
    });
    return members;
  }
  return [...members, ...membersOf(baseDeclaration, classesByName, file, problems, seen)];
}

export function scanControllerSource(source: string, file: string): ScanResult {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const imports = collectImports(parsed);
  const problems: ScanProblem[] = [];
  const routes: ScannedRoute[] = [];

  const classes = collectClasses(parsed);
  const classesByName = new Map(
    classes.flatMap((declaration) =>
      declaration.name ? [[declaration.name.text, declaration] as const] : [],
    ),
  );

  let controllersFound = 0;

  for (const declaration of classes) {
    const controller = findDecorator(declaration, imports, (ref) => isNest(ref, 'Controller'));
    if (!controller) continue;
    controllersFound += 1;

    const className = declaration.name?.text ?? '(anonymous class)';
    const prefix = pathArgument(controller);
    if (prefix.unreadable) {
      problems.push({
        file,
        message: `${className}'s @Controller() argument is not a plain string, so its path prefix cannot be read. Write the prefix as a string literal; the object form and template literals are not supported by this check.`,
      });
      continue;
    }

    const classAnonymous = readsAsAnonymous(declaration, imports, className, file, problems);
    const classThrottled = isThrottled(declaration, imports);

    for (const member of membersOf(declaration, classesByName, file, problems)) {
      if (!ts.isMethodDeclaration(member)) continue;
      const route = findDecorator(member, imports, (ref) =>
        METHOD_DECORATORS.has(ref.name) && (ref.module === undefined || ref.module === NEST_MODULE),
      );
      if (!route) continue;

      const methodName = decoratorRef(route, imports)?.name;
      if (!methodName) continue;

      const handlerName = ts.isIdentifier(member.name) ? member.name.text : member.name.getText(parsed);
      const handler = `${className}.${handlerName}`;

      const subPath = pathArgument(route);
      if (subPath.unreadable) {
        problems.push({
          file,
          message: `${handler}'s @${methodName}() argument is not a plain string, so its path cannot be read. An array of paths registers several routes and this check can govern none of them; write one string literal per handler.`,
        });
        continue;
      }

      routes.push({
        method: methodName.toLowerCase(),
        path: joinRoutePath(prefix.value ?? '', subPath.value ?? ''),
        // Either placement counts: every controller here marks the class, but
        // Nest honours the handler too, so both must be read or the check
        // would call a genuinely anonymous route protected.
        anonymous: classAnonymous || readsAsAnonymous(member, imports, handler, file, problems),
        throttled: classThrottled || isThrottled(member, imports),
        handler,
        className,
        file,
        bindings: bindingsOf(member, imports),
      });
    }
  }

  // Belt and braces: the file asked Nest for `Controller` and this scan found
  // none, so something here is shaped in a way the parse above does not cover.
  // Better a loud failure than a file that quietly contributes no routes.
  if (controllersFound === 0) {
    const importsController = [...imports.values()].some(
      (imported) => imported.original === 'Controller' && imported.module === NEST_MODULE,
    );
    if (importsController) {
      problems.push({
        file,
        message: `this file imports Controller from ${NEST_MODULE} but no controller class was found in it. If it declares one, this scan cannot see it, and any route on it would be live and undocumented.`,
      });
    }
  }

  return { routes, problems };
}

/**
 * Every `.ts` under `sourceDir` that could hold a controller, in a stable order.
 *
 * Deliberately NOT `*.controller.ts`. NestJS registers a controller by the
 * class listed in a module, never by the file name, so a filename glob left
 * the naming convention as the entire security boundary: a controller in
 * `admin.routes.ts` was invisible to both sides of the comparison and the
 * check reported success without opening it.
 */
export function controllerFiles(sourceDir: string): string[] {
  return readdirSync(sourceDir, { recursive: true, encoding: 'utf8' })
    .map((entry) => entry.split(sep).join('/'))
    .filter(
      (entry) =>
        entry.endsWith('.ts') &&
        !entry.endsWith('.d.ts') &&
        !entry.endsWith('.spec.ts') &&
        // Prisma's generated client: thousands of files, no controllers.
        !entry.startsWith('generated/'),
    )
    .sort();
}

export function scanControllers(sourceDir: string, repoRoot: string): ScanResult {
  const routes: ScannedRoute[] = [];
  const problems: ScanProblem[] = [];
  for (const entry of controllerFiles(sourceDir)) {
    const absolute = join(sourceDir, entry);
    const label = relative(repoRoot, absolute).split(sep).join('/');
    const result = scanControllerSource(readFileSync(absolute, 'utf8'), label);
    routes.push(...result.routes);
    problems.push(...result.problems);
  }
  return { routes, problems };
}

/**
 * Every controller class name listed in some module's `controllers: []`.
 *
 * A controller class on disk is not a route until a module registers it, so
 * this is what stops the wider file scan above from demanding a registry entry
 * (and publishing a route) for a class Nest never mounts.
 */
export function registeredControllers(sourceDir: string): Set<string> {
  const registered = new Set<string>();
  for (const entry of controllerFiles(sourceDir)) {
    if (!entry.endsWith('.module.ts')) continue;
    const source = readFileSync(join(sourceDir, entry), 'utf8');
    const parsed = ts.createSourceFile(entry, source, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (
        ts.isPropertyAssignment(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === 'controllers' &&
        ts.isArrayLiteralExpression(node.initializer)
      ) {
        for (const element of node.initializer.elements) {
          if (ts.isIdentifier(element)) registered.add(element.text);
        }
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(parsed, visit);
  }
  return registered;
}

/** `GET /grade/guess`, the key both sides of the comparison are matched on. */
export function routeKey(route: { method: string; path: string }): string {
  return `${route.method.toUpperCase()} ${route.path}`;
}
