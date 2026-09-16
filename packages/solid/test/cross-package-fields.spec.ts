/**
 * The cross-package `_`-field contract with `@solidjs/signals`.
 *
 * Signals' prod and observe artifacts mangle every `_`-prefixed property
 * (scripts/mangle-props.mjs) except a reserved list; the dev artifact is
 * unmangled. Any `_` field a downstream package reads or writes on a
 * signals object — an `Owner`, `Computed`, `Signal` — therefore only works
 * in every tier if it is on that list. The suite cannot see this: it runs
 * against source, where nothing is mangled. Two things went wrong before
 * this spec existed — the client's hydration root lookup walked `_parent`
 * (mangled → the wrong snapshot scope in prod), and the core's owner walks
 * found nothing on a server owner in the observe tier (`OBSERVE.exclude` a
 * silent no-op) — so the contract is pinned from both ends here:
 *
 *  - the reserved fields survive in the mangled signals artifacts, and a
 *    private one does not (so a change to the mangler's regex or list shows);
 *  - every `_` field the built client artifacts of solid-js and
 *    @solidjs/web touch is either reserved or not a signals field at all.
 *
 * Requires a prior `pnpm build`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, test } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const SIGNALS = join(ROOT, "signals");

/** The mangler's reserved list, read from the script so the two cannot drift. */
function reservedFields(): string[] {
  const script = readFileSync(join(SIGNALS, "scripts/mangle-props.mjs"), "utf8");
  const match = script.match(/reserved:\s*\[([^\]]*)\]/);
  if (!match) throw new Error("mangle-props.mjs: could not find the reserved list");
  return [...match[1].matchAll(/"(_\w+)"/g)].map(m => m[1]);
}

/** Every `_` field declared on signals' node types — the ones the mangler renames. */
function signalsFields(): Set<string> {
  const types = readFileSync(join(SIGNALS, "src/core/types.ts"), "utf8");
  return new Set([...types.matchAll(/^\s+(_\w+)\??:/gm)].map(m => m[1]));
}

function jsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== "types" && entry !== "node_modules") out.push(...jsFiles(path));
    } else if (entry.endsWith(".js")) out.push(path);
  }
  return out;
}

/** `._name` member accesses in `code`, by field, with a short context for the report. */
function fieldAccesses(code: string): Map<string, string> {
  const seen = new Map<string, string>();
  for (const m of code.matchAll(/\.(_[A-Za-z]\w*)\b/g)) {
    if (!seen.has(m[1])) seen.set(m[1], code.slice(Math.max(0, m.index! - 40), m.index! + 40));
  }
  return seen;
}

describe("cross-package _-fields", () => {
  const reserved = reservedFields();

  test("the mangler reserves the two owner fields downstream packages walk", () => {
    expect(reserved).toEqual(expect.arrayContaining(["_name", "_parent"]));
  });

  test("the reserved fields survive in the mangled signals artifacts; a private one does not", () => {
    for (const tier of ["prod", "observe"]) {
      const core = readFileSync(join(SIGNALS, `dist/${tier}/core/core.js`), "utf8");
      for (const field of reserved) expect(core, `${tier}: ${field}`).toMatch(`.${field}`);
      // `_firstChild` is the owner tree's other link and is private: its
      // absence proves the mangler ran on this file at all.
      expect(core, `${tier}: _firstChild should be mangled`).not.toMatch("._firstChild");
    }
    // The dev artifact is the unmangled one the suite runs against (flat and
    // code-split: the core sits in the chunk shared with the engine entry).
    const dev = readdirSync(join(SIGNALS, "dist"))
      .filter(f => /^dev.*\.js$/.test(f))
      .map(f => readFileSync(join(SIGNALS, "dist", f), "utf8"))
      .join("\n");
    expect(dev).toMatch("._firstChild");
  });

  test("the built client artifacts touch no signals field the mangler renames", () => {
    const fields = signalsFields();
    expect(fields.has("_parent")).toBe(true); // the parser found the node types
    const artifacts = [
      ...jsFiles(join(ROOT, "solid/dist")),
      ...jsFiles(join(ROOT, "web/dist")),
      ...jsFiles(join(ROOT, "web/frames/dist")),
      ...jsFiles(join(ROOT, "web/server-functions/dist")),
      ...jsFiles(join(ROOT, "universal/dist"))
    ].filter(
      // Server artifacts work on solid-js's own SSR owners, whose `_` fields
      // are solid-js's and unmangled; only the client's objects are signals'.
      f => !/[/\\]server[^/\\]*\.js$/.test(f) && !/[/\\]server[/\\]/.test(f)
    );
    expect(artifacts.length).toBeGreaterThan(5);
    const offenders: string[] = [];
    for (const file of artifacts) {
      for (const [field, context] of fieldAccesses(readFileSync(file, "utf8"))) {
        if (fields.has(field) && !reserved.includes(field))
          offenders.push(`${file.slice(ROOT.length + 1)}: ${field} — …${context.trim()}…`);
      }
    }
    expect(
      offenders,
      "a downstream artifact reads a signals `_` field the mangler renames — reserve it in " +
        "packages/signals/scripts/mangle-props.mjs or stop reaching into the node"
    ).toEqual([]);
  });
});
