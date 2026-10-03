/**
 * The shape of one row in the route registry (spec 0016).
 *
 * The registry is a deliberate, guarded duplication. Method, path, auth,
 * responses and prose live here because zod cannot know them; the controller
 * scan in `controller-scan.ts` is what stops that copy from going stale, and
 * `scripts/check-openapi.ts` is what makes a stale copy a build failure.
 *
 * Request shapes are the exception: they are never written here. A row names a
 * zod export from `@portfolio/shared` and the generator runs `z.toJSONSchema()`
 * on it, so a published request shape is the one that actually validates.
 */
import type { ZodType } from 'zod';

/** Every method `apps/api` currently serves. Widen it when a route needs more. */
export type HttpMethod = 'get' | 'post' | 'patch';

/** A JSON Schema 2020-12 object: generated for requests, hand authored for responses. */
export type JsonSchema = Record<string, unknown>;

/** One response a route can produce. */
export type ResponseSpec = {
  status: number;
  description: string;
  /** Omitted for a response with no body. */
  contentType?: string;
  /** Hand authored, read off the service return type. Omit for an empty body. */
  schema?: JsonSchema;
};

/**
 * A file part that arrives outside the zod body. Only multipart routes have
 * one: multer puts the upload on `req.file`, so it never reaches the schema
 * `ZodValidationPipe` parses and cannot be generated from it.
 */
export type MultipartFile = {
  name: string;
  description: string;
};

export type RouteEntry = {
  method: HttpMethod;
  /** OpenAPI form, with braces: `/grade/problems/{publicId}/image`. */
  path: string;
  /** True when the handler or its controller carries `@AllowAnonymous()`. */
  anonymous: boolean;
  /** One line. Rendered as the route heading in the Markdown. */
  summary: string;
  /** Prose: SSE event tables, coercion notes, anything a schema cannot say. */
  description?: string;
  /** A named zod export of `@portfolio/shared`. Never a hand written shape. */
  requestSchema?: ZodType;
  /** Defaults to `application/json`. */
  requestContentType?: string;
  /** The upload part on a multipart route, merged into the generated schema. */
  multipartFile?: MultipartFile;
  /** A named zod export of `@portfolio/shared`, one property per path parameter. */
  paramSchema?: ZodType;
  /**
   * A named zod export of `@portfolio/shared`, one property per query parameter.
   * Nothing uses this yet. It exists because `@Query` could already be bound
   * and validated while the document had no way to say so, and the check now
   * fails on a `@Query` binding whose row declares none.
   */
  querySchema?: ZodType;
  responses: ResponseSpec[];
  /** An environment variable that decides whether the route is registered at all. */
  conditionalOn?: string;
  /** Field name to note, rendered into the description where the schema cannot say it. */
  fieldNotes?: Record<string, string>;
};
