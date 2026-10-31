/**
 * @vitest-environment jsdom
 */
// async-gen rerun on next 5e68925c, seed 3289 (E2): reading every memo
// through an identity memo shows the same screens (D-41: a derivation of a
// staged error carries it, staged with the same frame).
// - The action makes m0 throw: `latest(m0)` throws the proposed error, so the
//   leaf errors to [ROOT-E] (D-22); through the identity memo it showed the
//   old `lm0:3`.
// - An identity memo over an errored m1 whose held re-run errors again:
//   `isPending` is true for both (D-23 iii); through the identity it was false.
import { expect, test } from "vitest";
import { runScenario } from "./run.js";

const latestThrows = {
  signals: [1, 2],
  memos: [{ async: false, deps: [{ src: { k: "s", i: 1 }, how: "plain" }], poison: 1 }],
  tree: {
    t: "show",
    when: { how: "plain", src: { k: "s", i: 1 } },
    child: {
      t: "leaf",
      text: [],
      attrs: [{ how: "latest", src: { k: "m", i: 0 } }],
      grouped: true
    },
    fallback: false
  },
  steps: [{ t: "action", s: 1, v: 0 }, { t: "task" }]
} as any;

const pendingOverError = {
  signals: [0],
  memos: [
    { async: false, deps: [{ src: { k: "s", i: 0 }, how: "plain" }], poison: 2 },
    {
      async: false,
      deps: [
        { src: { k: "m", i: 0 }, how: "plain" },
        { src: { k: "m", i: 0 }, how: "plain" }
      ],
      poison: 3
    }
  ],
  tree: {
    t: "leaf",
    text: [],
    attrs: [{ how: "pending", src: { k: "m", i: 1 } }],
    grouped: true
  },
  steps: [{ t: "action", s: 0, v: 2 }, { t: "task" }]
} as any;

test("minimized: latest() of a memo the action makes throw errors through an identity memo too", async () => {
  const direct = await runScenario(latestThrows, {});
  const identity = await runScenario(latestThrows, { identity: true });
  expect(identity.screens).toEqual(direct.screens);
  expect(identity.screens.at(-1)).toBe("[ROOT-E]");
});

test("minimized: isPending of an identity memo over a held re-run's new error is true", async () => {
  const direct = await runScenario(pendingOverError, {});
  const identity = await runScenario(pendingOverError, { identity: true });
  expect(identity.screens).toEqual(direct.screens);
  expect(identity.screens.at(-1)).toBe("<span data-a0=pm1:true ></span>");
});
