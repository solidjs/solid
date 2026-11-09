/**
 * @vitest-environment jsdom
 */
// async-gen rerun 2026-10-30, seed 3289 (E2, E3; D-22 amended 2026-10-30,
// F-9): an async memo's first answer resolves, and in the same synchronous
// turn a plain write re-asks it. The promise reaction runs after the write,
// so the landing and the re-ask are processed in one flush. The answer
// exists from when it resolved: `m0` is answered, then re-asked. `latest`
// shows the answer, the re-ask is a new question (`isPending` true), and an
// identity memo or a derived store over `m0` reads the same. The plain form
// showed `pm0:false`; the identity and store forms stayed on `[ROOT-L]`.
import { expect, test } from "vitest";
import { runScenario } from "./run.js";
import type { Scenario } from "./scenario.js";

const scenario = (s0: number, how: "pending" | "latest", pick: number, write: number) =>
  ({
    signals: [s0],
    memos: [{ async: true, deps: [{ src: { k: "s", i: 0 }, how: "plain" }], poison: null }],
    tree: {
      t: "leaf",
      text: [],
      attrs: [{ how, src: { k: "m", i: 0 } }],
      grouped: how === "pending"
    },
    steps: [{ t: "task" }, { t: "settle", pick }, { t: "write", s: 0, v: write }, { t: "task" }]
  }) as Scenario;

for (const [name, sc, final] of [
  // [s0=1 m0=async(s0)] <span fx[isPending(m0)]> :: t S5 s0=2 t
  ["isPending", scenario(1, "pending", 5, 2), "<span data-a0=pm0:true ></span>"],
  // [s0=2 m0=async(s0)] <span split[latest(m0)]> :: t S6 s0=0 t
  ["latest", scenario(2, "latest", 6, 0), "<span data-a0=lm0:3 ></span>"]
] as const)
  test(`${name}: a first answer landing in the tick a write re-asks it is answered`, async () => {
    for (const variant of [{}, { identity: true }, { store: true }]) {
      const r = await runScenario(sc, variant);
      expect(r.screens.at(-1), JSON.stringify(variant)).toBe(final);
    }
  });
