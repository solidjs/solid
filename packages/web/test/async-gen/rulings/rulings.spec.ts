/**
 * @vitest-environment jsdom
 *
 * Runs every executable ruling (types.ts) and checks the generated
 * SCENARIOS.md blocks are current. `RULINGS_WRITE=1` rewrites the blocks.
 */
import { describe, expect, it } from "vitest";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runScenario, type Result } from "../run.js";
import { RULINGS } from "./index.js";
import { norm, renderRuling, replaceBlock } from "./scenarios-md.js";
import type { Case } from "./types.js";

const here = dirname(fileURLToPath(import.meta.url));
const SCENARIOS = resolve(here, "../../../../signals/docs/SCENARIOS.md");

function expectFrames(res: Result, c: Case, tag = "") {
  let prev: string | undefined;
  for (const f of c.frames) {
    const i = f.after === "render" ? 0 : f.after + 1;
    const want = f.screen === "—" ? prev! : f.screen;
    expect(res.screens[i], `${tag} after ${String(f.after)}`).toBe(want);
    prev = want;
  }
  for (const x of c.forbid ?? [])
    expect(res.screens[x.after + 1], `${tag} ✗ ${x.why}`).not.toBe(x.screen);
}

const results = new Map<string, (Result | undefined)[]>();

for (const r of RULINGS)
  describe(`${r.id} ${r.title} (${r.rules.join(", ")})`, () => {
    r.cases.forEach((c, k) => {
      const status = c.status ?? r.status;
      const name = `case ${c.label || k + 1}`;
      it(`${name}: laws`, async () => {
        const res = await runScenario(c.scenario);
        // RULINGS_DUMP=S-44 appends every screen of that ruling to /tmp/rulings-dump.txt.
        if (process.env.RULINGS_DUMP === r.id)
          appendFileSync(
            "/tmp/rulings-dump.txt",
            `${r.id} ${name}\n` +
              res.screens.map((x, i) => `  [${i - 1}] ${x}`).join("\n") +
              `\n  settles: ${res.settles
                .map((l, i) => (l ? `${i}:${l}` : ""))
                .filter(Boolean)
                .join(" ")}\n`
          );
        (results.get(r.id) ?? results.set(r.id, []).get(r.id)!)[k] = res;
        expect(res.findings.filter(f => !c.allow?.includes(f.law))).toEqual([]);
        for (const law of c.allow ?? [])
          expect(
            res.findings.some(f => f.law === law),
            `expected a \`${law}\` finding`
          ).toBe(true);
      });
      (status === "ruled-not-built" ? it.fails : it)(
        `${name}: screens${status === "ruled-not-built" ? " (ruled, not built)" : ""}`,
        async () => {
          const res = await runScenario(c.scenario);
          expectFrames(res, c);
          for (const v of c.variants ?? [])
            expectFrames(await runScenario(c.scenario, v), c, JSON.stringify(v));
        }
      );
    });
  });

describe("docs", () => {
  it("SCENARIOS.md ruling blocks are current (RULINGS_WRITE=1 to regenerate)", async () => {
    let md = readFileSync(SCENARIOS, "utf8");
    const before = md;
    for (const r of RULINGS) {
      const observed = results.get(r.id) ?? [];
      for (let k = 0; k < r.cases.length; k++)
        observed[k] ??= await runScenario(r.cases[k].scenario);
      md = replaceBlock(md, r.id, renderRuling(r, observed));
    }
    if (process.env.RULINGS_WRITE) writeFileSync(SCENARIOS, md);
    else expect(norm(md), "run with RULINGS_WRITE=1 to regenerate").toBe(norm(before));
  });
});
