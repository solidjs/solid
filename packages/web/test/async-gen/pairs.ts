/**
 * The async-gen equivalence pairs: two runs of one scenario, rewritten without
 * changing its meaning, that must show the same screen at every settle point
 * (or, `finalOnly`, once everything settled). Used by campaign.spec.ts.
 */
import { runScenario, type Finding, type Result, type Variant } from "./run.js";
import type { Scenario } from "./scenario.js";

export const PAIR_DEFS: Record<
  string,
  { a: Variant; b: Variant; finalOnly?: boolean; quietOnly?: boolean }
> = {
  E1: { a: { grouped: true }, b: { split: true } },
  E2: { a: {}, b: { identity: true } },
  E2e: { a: {}, b: { inertErrored: true } },
  E3: { a: {}, b: { store: true } },
  E6: { a: {}, b: { autoFlush: true }, finalOnly: true },
  E7: { a: { owned: false }, b: { owned: true } },
  // The reader seat (carve audit): a reader born before a write vs one born
  // in the flush that applies it, compared where nothing is in flight (a
  // fresh reader of a pending node may show a fallback the old one holds);
  // `latest(x)` read in a derivation vs at the leaf.
  E8: { a: {}, b: { remount: true }, quietOnly: true },
  E9: { a: {}, b: { latestDerive: true } }
};

/** What a screen shows, coarsely: an error, a fallback, or content. */
export const shows = (x: string) =>
  /\[(ROOT-)?E\]/.test(x)
    ? "error"
    : /\[(ROOT-)?L\]/.test(x)
      ? "loading"
      : /\[F\]/.test(x)
        ? "show-fallback"
        : "content";
/** How two screens differ, for grouping: by what they show, then by which
 * kind of read disagrees (value / latest / isPending). */
export function kind(x: string, y: string): string {
  const [a, b] = [shows(x), shows(y)];
  if (a !== b) return `${a} vs ${b}`;
  const reads = (s: string) =>
    new Map([...s.matchAll(/([vlp])([sm]\d):([^ <]*)/g)].map(m => [m[1] + m[2], m[3]]));
  const [ra, rb] = [reads(x), reads(y)];
  const diff = new Set<string>();
  for (const [k, v] of ra)
    if (rb.get(k) !== v) diff.add(k[0] === "v" ? "value" : k[0] === "l" ? "latest" : "isPending");
  for (const k of rb.keys()) if (!ra.has(k)) diff.add("presence");
  return diff.size ? `${a}: ${[...diff].sort().join("+")} differ` : `${a}: structure differs`;
}

/**
 * E1 at screen `i`: the grouped run (`a`) shows a loading fallback where the
 * split run (`b`) shows the error, a grouped effect's pass ended on a first
 * load still in flight, and a later binding of that group reads a memo that
 * throws in the split run.
 *
 * D-28 (RULES-DERIVED.md): "a throw ends the pass … Order is not irrelevant.
 * A throw means the rest of the pass does not run, so the two orders are
 * different computations. What must not depend on order is the throw." The
 * grouped pass throws too (NotReady); it ends before the later binding's
 * error is read (async-gen #17). Only that is accepted: once the first load
 * lands the grouped pass reads the error, so a later screen or the settled
 * end state that still differs is reported.
 */
export function d28Grouping(a: Result, b: Result, i: number): boolean {
  if (shows(a.screens[i]) !== "loading" || shows(b.screens[i]) !== "error") return false;
  const memos = b.passes[i].memos;
  return Object.values(a.passes[i].held).some(later => later.some(m => memos[m] === "error"));
}

/** Compares pair `name`'s two runs; the finding, or null when they agree. */
export function comparePair(name: string, a: Result, b: Result): Finding | null {
  const def = PAIR_DEFS[name];
  const diff = def.finalOnly
    ? a.final !== b.final
      ? a.screens.length - 1
      : -1
    : a.screens.findIndex(
        (x, i) =>
          a.settled[i] &&
          b.settled[i] &&
          (!def.quietOnly || (a.quiet[i] && b.quiet[i])) &&
          x !== b.screens[i] &&
          !(name === "E1" && d28Grouping(a, b, i))
      );
  const at = diff >= 0 ? diff : a.final !== b.final ? a.screens.length : -1;
  if (at < 0) return null;
  const x = at < a.screens.length ? a.screens[at] : a.final;
  const y = at < b.screens.length ? b.screens[at] : b.final;
  return {
    oracle: "equivalence",
    law: name,
    step: at - 1,
    detail: `${kind(x, y)} :: ${x}  ≠  ${y}`
  };
}

/** Runs the scenario's pairs; returns their findings, plus the base run's. */
export async function runWithPairs(
  sc: Scenario,
  pairs: string[]
): Promise<{ base: Result; findings: Finding[] }> {
  const base = await runScenario(sc);
  const findings = [...base.findings];
  for (const name of pairs) {
    const def = PAIR_DEFS[name];
    const a = Object.keys(def.a).length ? await runScenario(sc, def.a) : base;
    const b = await runScenario(sc, def.b);
    const f = comparePair(name, a, b);
    if (f) findings.push(f);
  }
  return { base, findings };
}
