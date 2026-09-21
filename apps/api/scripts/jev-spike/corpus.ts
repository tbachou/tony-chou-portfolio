/**
 * Extracts the labelled credential corpus from `ownership-guard.spec.ts`.
 *
 * EXTRACTED, NOT COPIED, and that is the whole point of this file. The spec is
 * the source of truth: every sentence in it was produced by an adversarial
 * review that ran the real guard and captured a wrong verdict, across eight
 * rounds. A copied corpus would drift the moment a ninth round adds a case,
 * and the spike would then be measuring a stale instrument while reporting
 * confident numbers. Reading the spec at runtime means the corpus is whatever
 * the suite currently asserts, or the extraction fails loudly.
 *
 * It parses with the TypeScript compiler API rather than a regex, because a
 * regex over source is exactly the class of mistake this whole spike exists to
 * investigate. `.text` on a string literal node returns the COOKED value, so
 * `'’'` arrives as a real curly apostrophe — which matters, since a curly
 * apostrophe defeating every branch is one of the recorded historical bugs.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
// Uses the JS compiler API, which this repo still has on TypeScript ^6.0.3
// (verified: 2248 exports, ScriptTarget and createSourceFile present).
// TypeScript 7 is the Go port and its main entry drops that API entirely —
// `ts.ScriptTarget` is simply undefined, so this file would throw at runtime
// while typechecking clean. If a TS 7 upgrade lands, this extractor needs the
// API's new home, or replacing outright.
import ts from 'typescript';

export const SPEC_PATH = path.resolve(
  import.meta.dirname,
  '..',
  '..',
  'src',
  'modules',
  'conversation',
  'ownership-guard.spec.ts',
);

/**
 * The arrays the spec feeds to its `blocks:` assertion. Each sentence asserts a
 * clinical credential Tony does not hold, so the correct verdict is SUPPRESS.
 */
const CLAIM_ARRAYS = [
  'overclaims',
  'filleredOverclaims',
  'claimsWithTrailingPastTense',
  'maintenanceClaims',
  'curlyApostrophe',
  'modalClaims',
  'barePresentClaims',
  'otherCredentialWords',
] as const;

/**
 * The arrays the spec feeds to its `allows:` assertion. These matter MORE, in
 * the spec's own words: a guard that fires on the truth replaces a correct,
 * verified answer with a canned deflection, teaching the system to hide the
 * real career history rather than state it plainly.
 */
const HONEST_ARRAYS = ['honest', 'honestButKeywordDense'] as const;

export type Label = 'claim' | 'honest';

export type Case = {
  text: string;
  label: Label;
  /** Which spec array it came from, so a failure can be read in context. */
  group: string;
};

/**
 * The value of one array element, or null if it is not something this extractor
 * will evaluate.
 *
 * Handles plain string literals and ONE computed form: `'lit'.replace('a','b')`.
 * That form is not hypothetical — `curlyApostrophe[0]` in the spec is written
 * that way so the source line does not begin with a bare curly quote. Nothing
 * else is evaluated, deliberately: the moment this starts interpreting
 * expressions it becomes a small interpreter with its own bugs, which is the
 * exact failure mode the guard it is measuring already has.
 */
function literalValue(node: ts.Expression): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'replace' &&
    node.arguments.length === 2
  ) {
    const target = literalValue(node.expression.expression);
    const search = literalValue(node.arguments[0]);
    const replacement = literalValue(node.arguments[1]);
    if (target !== null && search !== null && replacement !== null) {
      return target.replace(search, replacement);
    }
  }
  return null;
}

type Extraction =
  { kind: 'ok'; values: string[] } | { kind: 'unevaluable'; offending: string };

function readStringArrays(
  source: string,
  filePath: string,
): Map<string, Extraction> {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
  );
  const found = new Map<string, Extraction>();

  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      const name = node.name.text;
      const values: string[] = [];
      let offending: string | null = null;
      for (const element of node.initializer.elements) {
        const value = literalValue(element);
        if (value === null) {
          offending ??= element.getText(sourceFile);
        } else {
          values.push(value);
        }
      }
      if (values.length > 0 || offending !== null) {
        if (found.has(name)) {
          throw new Error(
            `Two arrays in the spec are both named \`${name}\`. The extractor ` +
              `keys on the name, so it can no longer tell them apart. Rename one ` +
              `in the spec, or scope this extractor to a describe block.`,
          );
        }
        // An array with ANY unevaluable element is rejected whole. A partial
        // array would quietly shrink the corpus while the report still printed
        // a confident percentage.
        found.set(
          name,
          offending === null
            ? { kind: 'ok', values }
            : { kind: 'unevaluable', offending },
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/**
 * Reads the corpus, or throws with the name of whatever went missing. It never
 * degrades to a partial corpus: a spike that silently measured eight of ten
 * groups would report a number nobody could interpret.
 */
export function loadCorpus(specPath: string = SPEC_PATH): Case[] {
  if (!fs.existsSync(specPath)) {
    throw new Error(
      `Cannot find the spec at ${specPath}. If the guard moved, update ` +
        `SPEC_PATH in this file — do not paste the sentences in here.`,
    );
  }
  const arrays = readStringArrays(fs.readFileSync(specPath, 'utf8'), specPath);

  const cases: Case[] = [];
  const missing: string[] = [];

  for (const [names, label] of [
    [CLAIM_ARRAYS, 'claim'],
    [HONEST_ARRAYS, 'honest'],
  ] as const) {
    for (const name of names) {
      const extraction = arrays.get(name);
      if (!extraction) {
        missing.push(name);
        continue;
      }
      if (extraction.kind === 'unevaluable') {
        throw new Error(
          `\`${name}\` in ${path.basename(specPath)} contains an element this ` +
            `extractor will not evaluate:\n  ${extraction.offending}\n` +
            `Rejecting the array whole rather than measuring a partial one. ` +
            `Either simplify that element in the spec, or extend literalValue() ` +
            `in this file — and read its comment before you do.`,
        );
      }
      for (const text of extraction.values) {
        cases.push({ text, label, group: name });
      }
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `These arrays are no longer in ${path.basename(specPath)}: ` +
        `${missing.join(', ')}.\n` +
        `The spec was restructured. Fix CLAIM_ARRAYS / HONEST_ARRAYS in this ` +
        `file to match — an extractor that skipped them would measure a ` +
        `smaller corpus and still print a confident score.`,
    );
  }

  const seen = new Set<string>();
  for (const c of cases) {
    if (seen.has(c.text)) {
      throw new Error(
        `Duplicate sentence across groups: ${JSON.stringify(c.text)}. ` +
          `It would be counted twice and weight the score.`,
      );
    }
    seen.add(c.text);
  }

  return cases;
}
