import * as t from "@babel/types";
import type { NodePath } from "@babel/traverse";
import { sourceNames } from "../config";
import { getConfig } from "./utils";
import type { BabelHubWithMetadata } from "../types";

/**
 * The `sourceNames.locations` string for `node`: `<file>:<line>:<column>`,
 * the file relative to `config.root` (default: Babel's `cwd`, the working
 * directory) with posix separators, line and column both 1-based — the
 * stack-trace / editor convention, so a browser links
 * `http://localhost:5173/src/App.tsx:18:3` to the right place. Babel's
 * `loc.start.column` is 0-based, so it is bumped by one here (the refresh
 * pass's `location` keeps Babel's 0-based column; that is a different
 * consumer). A file outside `root` yields a path starting with `..`, emitted
 * as-is. `undefined` when the kind is off, when Babel was given no `filename`
 * for the module, or when `node` is synthetic and carries no `loc`.
 *
 * `@solidjs/compiler` computes the same string with `relative_id` so both
 * compilers print identical output.
 */
export function sourceLocation(path: NodePath, node: t.Node): string | undefined {
  const config = getConfig(path);
  if (!sourceNames(config).locations) return;
  const start = node.loc?.start;
  if (!start) return;
  const opts = (path.hub as unknown as BabelHubWithMetadata).file?.opts;
  const filename = opts?.filename;
  if (!filename) return;
  const cwd = opts?.cwd ?? "";
  const root = config.root ? resolve(cwd, config.root) : resolve(cwd, cwd);
  return `${relative(root, resolve(cwd, filename))}:${start.line}:${start.column + 1}`;
}

/**
 * A binding's `{ name, loc? }` options literal — `name` first, then `loc`
 * only when there is one, so both JSX compilers print the same text.
 */
export function bindingOptions(name: string, loc: string | undefined): t.ObjectExpression {
  const properties = [t.objectProperty(t.identifier("name"), t.stringLiteral(name))];
  if (loc !== undefined)
    properties.push(t.objectProperty(t.identifier("loc"), t.stringLiteral(loc)));
  return t.objectExpression(properties);
}

// Path arithmetic without node's `path` (this plugin bundles for any host):
// the same steps as `@solidjs/compiler`'s `relative_id` — resolve both paths
// against `cwd`, fold `.`/`..`, drop the common prefix.

/** `p` resolved against `base` (posix separators, `.`/`..` folded), as segments. */
function resolve(base: string, p: string): string[] {
  const posix = p.replace(/\\/g, "/");
  const absolute = /^(\/|[A-Za-z]:\/)/.test(posix);
  const joined = absolute ? posix : `${base.replace(/\\/g, "/")}/${posix}`;
  const segments: string[] = [];
  for (const segment of joined.split("/")) {
    if (segment === "." || (segment === "" && segments.length)) continue;
    if (segment === "..") {
      // Never past the root marker (`""` for `/…`, `C:` for a drive).
      if (segments.length > 1) segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments;
}

/** `file` relative to `root`, both resolved: `..` per root segment left, then the file's rest. */
function relative(root: string[], file: string[]): string {
  let i = 0;
  while (i < root.length && i < file.length && root[i] === file[i]) i++;
  return [...root.slice(i).map(() => ".."), ...file.slice(i)].join("/");
}
