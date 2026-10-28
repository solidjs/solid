/**
 * @vitest-environment jsdom
 *
 * The async app generator's campaign. Off by default; run with
 *
 *   ASYNC_GEN=1 [ASYNC_GEN_SEED=3289] [ASYNC_GEN_CASES=200]
 *   [ASYNC_GEN_IGNORE=final-screen,console-error] [ASYNC_GEN_MODE=survey|shrink]
 *   npx vitest run test/async-gen
 *
 * ASYNC_GEN_RECORD / ASYNC_GEN_DIFF (survey mode): see differential.ts.
 *
 * survey runs every case and tallies findings by law and signature; shrink
 * stops on the first finding outside ASYNC_GEN_IGNORE and prints the reduced
 * scenario as JSON for replay.spec.ts.
 */
import { describe, expect, test } from "vitest";
import fc from "fast-check";
import { recordOrDiff, type Trace } from "./differential.js";
import { minimize } from "./minimize.js";
import { runScenario, type Finding, type Result, type Variant } from "./run.js";
import { describeScenario, scenarioArb, type Scenario } from "./scenario.js";

const FUZZ = !!process.env.ASYNC_GEN;
const SEED = Number(process.env.ASYNC_GEN_SEED ?? 3289);
const CASES = Number(process.env.ASYNC_GEN_CASES ?? 200);
const IGNORE = new Set((process.env.ASYNC_GEN_IGNORE ?? "").split(",").filter(Boolean));
const MODE = process.env.ASYNC_GEN_MODE ?? "survey";

const PAIRS = (process.env.ASYNC_GEN_PAIRS ?? "").split(",").filter(Boolean);

const out = (s: string) => process.stdout.write(s + "\n");

/** The equivalence pairs: two runs of one scenario that must show the same
 * screen at every settle point (or, `finalOnly`, once everything settled). */
const PAIR_DEFS: Record<string, { a: Variant; b: Variant; finalOnly?: boolean }> = {
  E1: { a: { grouped: true }, b: { split: true } },
  E2: { a: {}, b: { identity: true } },
  E2e: { a: {}, b: { inertErrored: true } },
  E3: { a: {}, b: { store: true } },
  E6: { a: {}, b: { autoFlush: true }, finalOnly: true },
  E7: { a: { owned: false }, b: { owned: true } }
};

/** What a screen shows, coarsely: an error, a fallback, or content. */
const shows = (x: string) =>
  /\[(ROOT-)?E\]/.test(x)
    ? "error"
    : /\[(ROOT-)?L\]/.test(x)
      ? "loading"
      : /\[F\]/.test(x)
        ? "show-fallback"
        : "content";
/** How two screens differ, for grouping: by what they show, then by which
 * kind of read disagrees (value / latest / isPending). */
function kind(x: string, y: string): string {
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

/** Runs the scenario's pairs; returns their findings, plus the base run's. */
async function runWithPairs(sc: Scenario): Promise<{ base: Result; findings: Finding[] }> {
  const base = await runScenario(sc);
  const findings = [...base.findings];
  for (const name of PAIRS) {
    const def = PAIR_DEFS[name];
    const a = Object.keys(def.a).length ? await runScenario(sc, def.a) : base;
    const b = await runScenario(sc, def.b);
    const diff = def.finalOnly
      ? a.final !== b.final
        ? a.screens.length - 1
        : -1
      : a.screens.findIndex((x, i) => a.settled[i] && b.settled[i] && x !== b.screens[i]);
    const at = diff >= 0 ? diff : a.final !== b.final ? a.screens.length : -1;
    if (at >= 0) {
      const x = at < a.screens.length ? a.screens[at] : a.final;
      const y = at < b.screens.length ? b.screens[at] : b.final;
      findings.push({
        oracle: "equivalence",
        law: name,
        step: at - 1,
        detail: `${kind(x, y)} :: ${x}  ≠  ${y}`
      });
    }
  }
  return { base, findings };
}
const MATCH = process.env.ASYNC_GEN_MATCH ? new RegExp(process.env.ASYNC_GEN_MATCH) : null;
const real = (fs: Finding[]) =>
  fs.filter(f => !IGNORE.has(f.law) && (!MATCH || MATCH.test(`${f.oracle}/${f.law}: ${f.detail}`)));
/** A signature groups findings by law and the first words of the detail,
 * with numbers and values stripped. */
const signature = (f: Finding) =>
  f.oracle === "equivalence"
    ? `${f.oracle}/${f.law}: ${f.detail.slice(0, f.detail.indexOf(" :: "))}`
    : `${f.oracle}/${f.law}: ${f.detail.replace(/\d+/g, "#").replace(/≠.*/, "≠ …").slice(0, 90)}`;

describe("async-gen", () => {
  test("smoke: a settled async memo under Loading shows its value", async () => {
    const result = await runScenario({
      signals: [1],
      memos: [{ async: true, deps: [{ src: { k: "s", i: 0 }, how: "plain" }], poison: null }],
      tree: {
        t: "leaf",
        text: [{ how: "plain", src: { k: "m", i: 0 } }],
        attrs: [],
        grouped: true
      },
      steps: [{ t: "settle", pick: 0 }, { t: "task" }, { t: "write", s: 0, v: 2 }, { t: "task" }]
    });
    expect(result.findings).toEqual([]);
    expect(result.final).toBe("<span>vm0:3 </span>");
  });
});

describe.skipIf(!FUZZ)("async-gen campaign", () => {
  test(`seed ${SEED}, ${CASES} cases, mode ${MODE}`, { timeout: 0 }, async () => {
    const arb = scenarioArb();
    if (MODE === "shrink") {
      try {
        await fc.assert(
          fc.asyncProperty(arb, async sc => {
            const r = await runWithPairs(sc);
            const f = real(r.findings)[0];
            if (f)
              throw new Error(
                `${f.oracle}/${f.law} @${f.step}: ${f.detail}\n${r.base.description}\n${JSON.stringify(sc)}`
              );
          }),
          { seed: SEED, numRuns: CASES, endOnFailure: true }
        );
        out(`async-gen: seed ${SEED}, ${CASES} cases, no finding outside [${[...IGNORE]}]`);
      } catch (e: any) {
        out(String(e?.message ?? e));
        throw e;
      }
      return;
    }
    const tally = new Map<string, { count: number; first: Scenario; detail: string }>();
    let failing = 0;
    const traces: Record<number, Trace> = {};
    let idx = 0;
    for (const sc of fc.sample(arb, { seed: SEED, numRuns: CASES })) {
      const r = await runWithPairs(sc);
      traces[idx++] = {
        screens: r.base.screens,
        final: r.base.final,
        laws: [...new Set(r.findings.map(f => `${f.oracle}/${f.law}`))].sort()
      };
      const fs = real(r.findings);
      if (fs.length) failing++;
      const seen = new Set<string>();
      for (const f of fs) {
        const sig = signature(f);
        if (seen.has(sig)) continue;
        seen.add(sig);
        const t = tally.get(sig);
        if (t) t.count++;
        else tally.set(sig, { count: 1, first: sc, detail: `@${f.step} ${f.detail}` });
      }
    }
    const diffs = recordOrDiff(`client${PAIRS.length ? `+${PAIRS}` : ""}`, SEED, CASES, traces);
    if (diffs.length)
      out(`async-gen differential: ${diffs.length} cases differ\n  ${diffs.join("\n  ")}`);
    out(
      `async-gen survey: seed ${SEED}, ${CASES} cases, ${failing} with findings, ${tally.size} signatures`
    );
    for (const [sig, t] of [...tally].sort((a, b) => b[1].count - a[1].count)) {
      out(`  ${t.count}× ${sig}`);
      out(`     ${describeScenario(t.first)}`);
      out(`     ${t.detail.slice(0, 300)}`);
      if (MODE !== "minimize") continue;
      // Reduce while some finding keeps the same oracle/law.
      const law = sig.slice(0, sig.indexOf(":"));
      const min = await minimize(t.first, async sc =>
        real((await runWithPairs(sc)).findings).some(f => `${f.oracle}/${f.law}` === law)
      );
      const r = await runWithPairs(min);
      const f = real(r.findings).find(f => `${f.oracle}/${f.law}` === law)!;
      out(`     MIN ${r.base.description}`);
      out(`     MIN @${f.step} ${f.detail.slice(0, 300)}`);
      out(`     MIN ${JSON.stringify(min)}`);
    }
    expect(diffs, "cases that differ from ASYNC_GEN_DIFF's recording").toEqual([]);
  });
});
