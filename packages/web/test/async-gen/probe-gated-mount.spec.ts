/**
 * @vitest-environment jsdom
 */
// A mount gated directly by a memo that reads a probe tears (F-1, D-27).
// `<Show>` keeps a sync truthiness memo between its async-aware condition
// memo and its branch memo, so `<Show when={isPending(m0)}>` is not
// affected. Without that hop, e1-3289-1831's minimized scenario shows a
// grouped leaf that never paints its attributes (`<span></span>`) where the
// split leaf and `<Show>` paint `data-a0=lm2:4`:
// - `gate: "ternary"`: the compiler's `{isPending(m0) ? … : "[F]"}`, live
//   on `next` today for hand-written ternaries;
// - `gate: "memo"`: a Show trimmed to one memo per condition (parked on
//   that account). With that shape the #4405 minimized scenario in
//   errored-recovery-wedge-4403-4405 also times out (not pinned: ~90s).
// When the engine handles these, `<Show>` can drop its hop and the
// compiler can lower a non-callback `<Show>` to a ternary.
import { expect, test } from "vitest";
import { runScenario } from "./run.js";

const minimized = {
  signals: [0],
  memos: [
    { async: true, deps: [{ src: { k: "s", i: 0 }, how: "plain" }], poison: null },
    {
      async: false,
      deps: [
        { src: { k: "s", i: 0 }, how: "plain" },
        { src: { k: "m", i: 0 }, how: "latest" }
      ],
      poison: 0
    },
    {
      async: false,
      deps: [
        { src: { k: "m", i: 0 }, how: "latest" },
        { src: { k: "m", i: 1 }, how: "plain" }
      ],
      poison: 1
    }
  ],
  tree: {
    t: "show",
    when: { how: "pending", src: { k: "m", i: 0 } },
    child: {
      t: "leaf",
      text: [],
      attrs: [
        { how: "latest", src: { k: "m", i: 2 } },
        { how: "plain", src: { k: "m", i: 0 } }
      ],
      grouped: true
    },
    fallback: true
  },
  steps: [{ t: "settle", pick: 5 }, { t: "task" }, { t: "write", s: 0, v: 1 }, { t: "task" }]
} as any;

test("Show: grouped and split agree (the hop keeps it whole)", async () => {
  const shown = await runScenario(minimized, { grouped: true });
  expect(shown.screens).toEqual((await runScenario(minimized, { split: true })).screens);
});

for (const gate of ["ternary", "memo"] as const)
  test.fails(
    `gate ${gate}: a grouped leaf under a probe-gated mount paints as Show does`,
    async () => {
      const shown = await runScenario(minimized, { grouped: true });
      const gated = await runScenario(minimized, { grouped: true, gate });
      expect(gated.screens).toEqual(shown.screens);
    }
  );
