/**
 * @vitest-environment jsdom
 */
// async-gen rerun on next 5e68925c, seed 3289 (E2): over an errored memo, a
// plain write then an action that nets it back to the committed value in one
// tick made no proposal (D-8), so `isPending(m0)` stays false (F-9) and the
// `Show` it gates never opens. The memo read directly opened it (the re-run's
// error was held with the action); through an identity memo it did not.
import { expect, test } from "vitest";
import { runScenario } from "./run.js";

const minimized = {
  signals: [1],
  memos: [{ async: false, deps: [{ src: { k: "s", i: 0 }, how: "plain" }], poison: 2 }],
  tree: {
    t: "show",
    when: { how: "pending", src: { k: "m", i: 0 } },
    child: { t: "leaf", text: [], attrs: [], grouped: true },
    fallback: false
  },
  steps: [{ t: "write", s: 0, v: 2 }, { t: "action", s: 0, v: 1 }, { t: "task" }]
} as any;

test("minimized: writes that net to the committed value open no isPending gate", async () => {
  const direct = await runScenario(minimized, {});
  const identity = await runScenario(minimized, { identity: true });
  expect(direct.screens).toEqual(identity.screens);
  expect(direct.screens).toEqual(["", "", "", ""]);
});
