/**
 * Authored lazy destructuring (`&{ … }` / `&[ … ]`) is not part of the Solid
 * TSRX target. TSRX removed the sigil from the language, and Solid never
 * lowered it: a binding that reads like a value but compiles to a property
 * read is the hazard Solid keeps explicit with accessor calls. Parsers that
 * still produce the pattern are rejected here, before any desugaring, so the
 * failure is one clear message rather than a downstream type error.
 */

import type { EsNode } from "./desugar";

const SKIP_KEYS = new Set([
  "type",
  "loc",
  "start",
  "end",
  "range",
  "metadata",
  "leadingComments",
  "trailingComments",
  "innerComments"
]);

function isNode(value: unknown): value is EsNode {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

function fail(message: string, node?: EsNode | null): never {
  const start = (node?.loc as { start?: { line: number; column: number } } | undefined)?.start;
  throw new SyntaxError(start ? `${message} (${start.line}:${start.column})` : message);
}

const AUTHORED_LAZY_UNSUPPORTED =
  "Solid's TSRX frontend does not support authored lazy destructuring; keep property and accessor reads explicit";

/** Reject parser-authored `&{}` / `&[]` anywhere in the module. */
export function rejectAuthoredLazyDestructuring(root: EsNode): void {
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }
    if (!isNode(value)) return;
    if ((value.type === "ObjectPattern" || value.type === "ArrayPattern") && value.lazy === true) {
      fail(AUTHORED_LAZY_UNSUPPORTED, value);
    }
    for (const key of Object.keys(value)) {
      if (!SKIP_KEYS.has(key)) visit(value[key]);
    }
  };
  visit(root);
}
