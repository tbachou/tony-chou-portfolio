/**
 * Renders the OpenAPI document as Markdown that GitHub displays without a
 * viewer (spec 0016, AC-7).
 *
 * It takes the built document object, not the registry, so the two committed
 * artifacts are two renderings of one thing and cannot disagree. Everything
 * here is presentation: no fact reaches this file that is not already in the
 * document.
 */
import type { OpenApiDocument } from './document.js';
import { tagFor } from './document.js';
import type { JsonSchema } from './types.js';

const METHOD_ORDER = ['get', 'post', 'patch', 'put', 'delete'];

/** Table cells are pipe delimited, so any pipe inside one has to be escaped. */
function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n+/g, ' ');
}

function refName(schema: JsonSchema): string | undefined {
  const ref = schema.$ref;
  return typeof ref === 'string' ? ref.split('/').pop() : undefined;
}

/** `string`, `string \| null`, `string[]`, `object[]`. */
function typeName(schema: JsonSchema): string {
  const ref = refName(schema);
  if (ref) return ref;
  if (Array.isArray(schema.oneOf)) {
    return (schema.oneOf as JsonSchema[]).map(typeName).join(' | ');
  }
  const type = schema.type;
  if (Array.isArray(type)) return type.join(' | ');
  if (type === 'array') {
    const items = (schema.items ?? {}) as JsonSchema;
    return `${typeName(items)}[]`;
  }
  return typeof type === 'string' ? type : 'any';
}

const SAFE_INT_MAX = 9007199254740991;

/** Everything the schema says beyond its type, in one readable phrase. */
function constraints(schema: JsonSchema): string[] {
  const notes: string[] = [];
  if (typeof schema.description === 'string') notes.push(schema.description);
  const ownEnum = schema.enum;
  const itemEnum = (schema.items as JsonSchema | undefined)?.enum;
  const enumValues = Array.isArray(ownEnum) ? ownEnum : itemEnum;
  if (Array.isArray(enumValues)) {
    const lead = Array.isArray(ownEnum) ? 'one of' : 'each one of';
    notes.push(`${lead} ${enumValues.map((v) => `\`${String(v)}\``).join(', ')}`);
  }
  if (typeof schema.format === 'string') notes.push(`format \`${schema.format}\``);
  const { minLength, maxLength, minimum, maximum, maxItems, pattern } = schema as {
    minLength?: number;
    maxLength?: number;
    minimum?: number;
    maximum?: number;
    maxItems?: number;
    pattern?: string;
  };
  if (minLength !== undefined || maxLength !== undefined) {
    notes.push(`${minLength ?? 0} to ${maxLength ?? '∞'} characters`);
  }
  if (minimum !== undefined || maximum !== undefined) {
    // zod stamps the JavaScript safe integer range on an unbounded `.int()`.
    // That is a fact about the number type, not about this field.
    if (minimum === -SAFE_INT_MAX && maximum === SAFE_INT_MAX) notes.push('safe integer');
    else notes.push(`${minimum ?? '−∞'} to ${maximum ?? '∞'}`);
  }
  if (maxItems !== undefined) notes.push(`at most ${maxItems} items`);
  if (typeof pattern === 'string') notes.push(`matches \`${pattern}\``);
  if (schema.default !== undefined) notes.push(`defaults to \`${JSON.stringify(schema.default)}\``);
  return notes;
}

type FieldRow = { path: string; type: string; required: boolean; notes: string };

/** Flattens an object schema into dotted rows, so one table shows the whole shape. */
function fieldRows(schema: JsonSchema, prefix = ''): FieldRow[] {
  const properties = (schema.properties ?? {}) as Record<string, JsonSchema>;
  const required = new Set((schema.required ?? []) as string[]);
  const rows: FieldRow[] = [];

  for (const [name, property] of Object.entries(properties)) {
    const path = prefix ? `${prefix}.${name}` : name;
    rows.push({
      path,
      type: typeName(property),
      required: required.has(name),
      notes: constraints(property).join('; '),
    });

    // Recurse into anything that carries its own properties, so a nested shape
    // is readable in the same table rather than hidden behind a type name.
    if (property.type === 'object' && property.properties) {
      rows.push(...fieldRows(property, path));
    } else if (property.type === 'array') {
      const items = (property.items ?? {}) as JsonSchema;
      if (items.type === 'object' && items.properties) {
        rows.push(...fieldRows(items, `${path}[]`));
      }
    } else if (Array.isArray(property.oneOf)) {
      for (const branch of property.oneOf as JsonSchema[]) {
        if (branch.type === 'object' && branch.properties) {
          rows.push(...fieldRows(branch, path));
        }
      }
    }
  }
  return rows;
}

function fieldTable(schema: JsonSchema, { strictNote = false } = {}): string[] {
  const rows = fieldRows(schema);
  if (rows.length === 0) return [];
  // Only on a request: it describes what `.strict()` does to an unexpected
  // property the caller sent. Saying it about a response would claim something
  // about the service's own output that this document does not check.
  const extra =
    strictNote && schema.additionalProperties === false
      ? ['', '_Any property not listed is rejected, it is not dropped._']
      : [];
  return [
    '| Field | Type | Required | Notes |',
    '|---|---|---|---|',
    ...rows.map(
      (r) => `| \`${r.path}\` | ${cell(r.type)} | ${r.required ? 'yes' : 'no'} | ${cell(r.notes)} |`,
    ),
    ...extra,
  ];
}

/** A stable anchor, so the index links survive any heading rewording. */
function anchor(operationId: string): string {
  return `op-${operationId}`;
}

function sortedOperations(document: OpenApiDocument) {
  const operations: { path: string; method: string; op: Record<string, unknown> }[] = [];
  for (const [path, methods] of Object.entries(document.paths)) {
    for (const method of METHOD_ORDER) {
      const op = methods[method] as Record<string, unknown> | undefined;
      if (op) operations.push({ path, method, op });
    }
  }
  return operations;
}

function renderOperation(path: string, method: string, op: Record<string, unknown>): string[] {
  const operationId = String(op.operationId);
  const security = op.security as unknown[];
  const anonymous = Array.isArray(security) && security.length === 0;
  const lines: string[] = [
    `<a id="${anchor(operationId)}"></a>`,
    '',
    `### \`${method.toUpperCase()} ${path}\``,
    '',
    `**${String(op.summary)}**`,
    '',
    `Auth: ${anonymous ? 'anonymous' : 'better-auth session cookie'}`,
  ];

  if (op.description) lines.push('', String(op.description));

  const parameters = op.parameters as { name: string; schema: JsonSchema }[] | undefined;
  if (parameters?.length) {
    lines.push(
      '',
      '**Path parameters**',
      '',
      '| Parameter | Type | Notes |',
      '|---|---|---|',
      ...parameters.map(
        (p) =>
          `| \`${p.name}\` | ${cell(typeName(p.schema))} | ${cell(constraints(p.schema).join('; '))} |`,
      ),
    );
  }

  const requestBody = op.requestBody as
    | { content: Record<string, { schema: JsonSchema }> }
    | undefined;
  if (requestBody) {
    const [contentType, media] = Object.entries(requestBody.content)[0];
    lines.push(
      '',
      `**Request body** (\`${contentType}\`)`,
      '',
      ...fieldTable(media.schema, { strictNote: true }),
    );
  }

  const responses = op.responses as Record<
    string,
    { description: string; content?: Record<string, { schema?: JsonSchema }> }
  >;
  lines.push('', '**Responses**', '', '| Status | Body | Description |', '|---|---|---|');
  for (const [status, response] of Object.entries(responses)) {
    const entry = response.content ? Object.entries(response.content)[0] : undefined;
    const contentType = entry?.[0];
    const schema = entry?.[1]?.schema;
    const ref = schema ? refName(schema) : undefined;
    const body = !contentType
      ? 'none'
      : ref
        ? `[\`${ref}\`](#${ref.toLowerCase()})`
        : `\`${contentType}\``;
    lines.push(`| \`${status}\` | ${body} | ${cell(response.description)} |`);
  }

  // The success body, once, as a field table. Errors are the two shared shapes
  // at the foot of the file, so repeating them per route would be noise.
  const success = Object.entries(responses).find(([status]) => status.startsWith('2'));
  const successSchema = success?.[1].content
    ? Object.values(success[1].content)[0]?.schema
    : undefined;
  if (successSchema && !refName(successSchema)) {
    const table =
      successSchema.type === 'array'
        ? fieldTable((successSchema.items ?? {}) as JsonSchema)
        : fieldTable(successSchema);
    if (table.length > 0) {
      const label =
        successSchema.type === 'array'
          ? `**\`${success?.[0]}\` response body** (one array element)`
          : `**\`${success?.[0]}\` response body**`;
      lines.push('', label, '', ...table);
    }
  }

  return lines;
}

export function renderMarkdown(document: OpenApiDocument): string {
  const operations = sortedOperations(document);
  const lines: string[] = [
    `# ${String(document.info.title)}`,
    '',
    '<!--',
    '  Generated from packages/shared/contracts.ts plus apps/api/src/openapi/route-registry.ts.',
    '  Do not edit by hand: `npm run check:openapi --workspace=apps/api` fails on any difference.',
    '  Regenerate with `npm run build:openapi --workspace=apps/api`.',
    '-->',
    '',
    `Version \`${String(document.info.version)}\` · OpenAPI ${document.openapi} · [\`openapi.json\`](openapi.json)`,
    '',
    String(document.info.description),
    '',
    '## Every route',
    '',
    '| Route | Auth | Summary |',
    '|---|---|---|',
  ];

  for (const { path, method, op } of operations) {
    const security = op.security as unknown[];
    const anonymous = Array.isArray(security) && security.length === 0;
    const conditional = op['x-conditional-on'];
    const auth = anonymous ? 'anonymous' : 'session';
    const summary = conditional
      ? `${String(op.summary)} (only when \`${String(conditional)}\` is set)`
      : String(op.summary);
    lines.push(
      `| [\`${method.toUpperCase()} ${path}\`](#${anchor(String(op.operationId))}) | ${auth} | ${cell(summary)} |`,
    );
  }

  for (const tag of document.tags) {
    const inTag = operations.filter(({ path }) => tagFor(path) === tag.name);
    if (inTag.length === 0) continue;
    lines.push('', `## ${tag.name}`, '', tag.description);
    for (const { path, method, op } of inTag) {
      lines.push('', ...renderOperation(path, method, op));
    }
  }

  const schemas = (document.components as { schemas: Record<string, JsonSchema> }).schemas;
  lines.push('', '## Shared error shapes', '', 'Every error response uses one of these two.');
  for (const [name, schema] of Object.entries(schemas)) {
    lines.push('', `<a id="${name.toLowerCase()}"></a>`, '', `### \`${name}\``, '', ...fieldTable(schema));
  }

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}
