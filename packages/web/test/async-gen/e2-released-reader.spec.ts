/**
 * @vitest-environment jsdom
 */
// async-gen E2/E3 (3289 #310, 91501 #1993, 91501 #2609; D-22 amended
// 2026-10-30, F-9): an async memo answered, then re-asked in one flush, with
// its input read through `latest()`. The landing ran before the re-ask
// reached the memo, so it released the identity memo's (and the derived
// store's) wait, and the served-only-while-waiting rule left them on
// `[ROOT-L]` while the plain form showed the answer.
import { expect, test } from "vitest";
import fc from "fast-check";
import { runScenario } from "./run.js";
import { scenarioArb } from "./scenario.js";

for (const [seed, i] of [
  [3289, 310],
  [91501, 1993],
  [91501, 2609]
] as [number, number][])
  test(`${seed} #${i}: an identity memo and a derived store show what the memo shows`, async () => {
    const sc = fc.sample(scenarioArb(), { seed, numRuns: i + 1 })[i];
    const a = await runScenario(sc);
    for (const variant of [{ identity: true }, { store: true }]) {
      const b = await runScenario(sc, variant);
      const at = (r: typeof a) => r.screens.filter((_, j) => a.settled[j] && b.settled[j]);
      expect(at(b), JSON.stringify(variant)).toEqual(at(a));
    }
  });
