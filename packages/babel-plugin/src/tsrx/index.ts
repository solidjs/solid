/**
 * TSRX syntax frontend entry point.
 *
 * Routes `.tsrx` sources (or any source when `syntax: "tsrx"`) through
 * `@tsrx/core`'s parser + semantic analysis, processes scoped styles with
 * core's CSS helpers, desugars every TSRX construct to Solid builtIn JSX,
 * applies Solid's local lazy-destructuring transform, and converts the result
 * to a Babel `File` for the unchanged JSX pipeline.
 *
 * `@tsrx/core` is an optional peer dependency loaded lazily on first TSRX
 * routing, so plain JSX users never pay for it.
 */

import { desugarProgram, restoreIntrinsicJsxNames, type EsNode } from "./desugar";
import { toBabelFile } from "./estree-to-babel";
import { applyLazyTransforms } from "./lazy";
import { processTsrxStyles, type TsrxStyleCore } from "./style";
import type { TsrxBabelAst, TsrxStyleResult } from "../types";

// The plugin ships as CJS; `require` of the ESM-only `@tsrx/core` is
// supported natively on Node >= 22.12. No @types/node in this package.
declare const require: ((id: string) => unknown) | undefined;

interface TsrxCore extends TsrxStyleCore {
  parseModule(source: string, filename?: string | null): EsNode;
  analyzeTsrx(ast: EsNode, filename?: string | null): unknown;
}

export type TsrxBabelFile = TsrxBabelAst & {
  tsrxStyle: TsrxStyleResult;
};

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
export function parseTsrx(code: string, filename?: string): TsrxBabelFile {
  const tsrx = loadTsrxCore();
  const program = tsrx.parseModule(code, filename ?? "module.tsrx");
  // Throws structured diagnostics (invalid returns, misplaced directives, …).
  tsrx.analyzeTsrx(program, filename ?? null);
  const styleResult = processTsrxStyles(program, tsrx);

  // Desugar before the lazy transform: the lazy engine collects block-level
  // `let &[…]`/`const &{…}` bindings in its BlockStatement/Program handlers,
  // which only fire once `@{}` containers have become real blocks. Lazy
  // patterns themselves pass through the desugarer untouched.
  desugarProgram(program);

  const transformed = applyLazyTransforms(program);
  // Keep this compatibility repair in place for trees produced by older
  // desugaring paths. The local engine itself never rewrites intrinsic names.
  restoreIntrinsicJsxNames(transformed);

  const file = toBabelFile(transformed) as TsrxBabelFile;
  // Babel's default AST clone preserves enumerable string keys. Program.enter
  // lifts this temporary payload into transform metadata and removes it from
  // the AST, avoiding mutable plugin-factory state (and concurrent-run races).
  file.tsrxStyle = styleResult;
  return file;
}
