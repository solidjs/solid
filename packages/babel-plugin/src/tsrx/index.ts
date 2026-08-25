/**
 * TSRX syntax frontend entry point.
 *
 * Routes `.tsrx` sources (or any source when `syntax: "tsrx"`) through
 * `@tsrx/core`'s parser + semantic analysis + lazy-destructuring transform,
 * desugars every TSRX construct to Solid builtIn JSX, and converts the result
 * to a Babel `File` for the unchanged JSX pipeline.
 *
 * `@tsrx/core` is an optional peer dependency loaded lazily on first TSRX
 * routing, so plain JSX users never pay for it.
 */

import type * as t from "@babel/types";
import { desugarProgram, restoreIntrinsicJsxNames, type EsNode } from "./desugar";
import { toBabelFile } from "./estree-to-babel";

// The plugin ships as CJS; `require` of the ESM-only `@tsrx/core` is
// supported natively on Node >= 22.12. No @types/node in this package.
declare const require: ((id: string) => unknown) | undefined;

interface TsrxCore {
  parseModule(source: string, filename?: string | null): EsNode;
  analyzeTsrx(ast: EsNode, filename?: string | null): unknown;
  createLazyContext(): unknown;
  preallocateLazyIds(root: EsNode, context: unknown): void;
  applyLazyTransforms(node: EsNode, lazyBindings: Map<string, unknown>): EsNode;
}

let core: TsrxCore | undefined;

function loadTsrxCore(): TsrxCore {
  if (core) return core;
  if (typeof require !== "function") {
    throw new Error(
      "@solidjs/babel-plugin: TSRX support requires a CommonJS environment with `require` available."
    );
  }
  try {
    core = require("@tsrx/core") as TsrxCore;
  } catch (error) {
    const err = error as { code?: string; message?: string };
    if (err.code === "MODULE_NOT_FOUND") {
      throw new Error(
        "@solidjs/babel-plugin: compiling .tsrx sources requires the optional peer dependency `@tsrx/core`. Install it with your package manager (e.g. `pnpm add -D @tsrx/core`)."
      );
    }
    if (err.code === "ERR_REQUIRE_ESM" || err.code === "ERR_REQUIRE_ASYNC_MODULE") {
      throw new Error(
        "@solidjs/babel-plugin: loading `@tsrx/core` synchronously requires Node.js >= 22.12 (require(esm) support)."
      );
    }
    throw error;
  }
  return core;
}

export type SyntaxOption = "auto" | "jsx" | "tsrx";

/** Whether the given file should be parsed as TSRX under the configured
 * `syntax` option. */
export function isTsrxSource(syntax: SyntaxOption | undefined, filename: unknown): boolean {
  const mode = syntax ?? "auto";
  if (mode === "tsrx") return true;
  if (mode === "jsx") return false;
  return typeof filename === "string" && filename.endsWith(".tsrx");
}

/** Parse TSRX source text into a Babel `File` with all TSRX constructs
 * lowered to Solid builtIn JSX. */
export function parseTsrx(code: string, filename?: string): t.File {
  const tsrx = loadTsrxCore();
  const program = tsrx.parseModule(code, filename ?? "module.tsrx");
  // Throws structured diagnostics (invalid returns, misplaced directives, …).
  tsrx.analyzeTsrx(program, filename ?? null);

  // Desugar before the lazy transform: the lazy engine collects block-level
  // `let &[…]`/`const &{…}` bindings in its BlockStatement/Program handlers,
  // which only fire once `@{}` containers have become real blocks. Lazy
  // patterns themselves pass through the desugarer untouched.
  desugarProgram(program);

  const lazyContext = tsrx.createLazyContext();
  tsrx.preallocateLazyIds(program, lazyContext);
  const transformed = tsrx.applyLazyTransforms(program, new Map());
  // The lazy engine wrongly rewrites intrinsic lowercase tags whose name
  // collides with a lazy binding; undo those rewrites (upstream bug).
  restoreIntrinsicJsxNames(transformed);

  return toBabelFile(transformed);
}
