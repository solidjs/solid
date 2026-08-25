// Graph (the router redirect shape, distilled):
//
//   route ──> mid ──> outlet (owns the mounted branch)
//                       ├─ branch "a": pageData (reads `version`) + effect
//                       └─ branch "b": async memo (pending promise)
//
// When `route` and `version` are written in the same batch and the route swap
// parks on branch "b"'s async, the batch becomes the transition: neither write
// commits until it does. Branch "a" becomes the zombie old tree, displayed
// (mainline) until commit — so pageData's queued recompute would observe a
// world the zombie never renders. The scheduler must cancel it at the park
// point: running it is unobservable work whose user side effects leak
// uncommitted state (the router's phantom refetch on single-flight redirects).
//
// A write in a LATER, separate flush is mainline truth and must still reach
// the zombie (the displayed old tree updates) — second test.

import { createMemo, createRenderEffect, createRoot, createSignal, flush } from "../src/index.js";

afterEach(() => flush());

function setup() {
  const [route, setRoute] = createSignal("a");
  const [version, setVersion] = createSignal(0);
  const state = { pageRuns: 0, seen: [] as number[] };
  let resolveB: (v: string) => void = () => {};

  const dispose = createRoot(d => {
    const mid = createMemo(() => route());
    const outlet = createMemo(() => {
      if (mid() === "a") {
        const pageData = createMemo(() => {
          state.pageRuns++;
          const v = version();
          state.seen.push(v);
          return v;
        });
        createRenderEffect(pageData, () => {});
        return "A";
      }
      return createMemo(() => new Promise<string>(r => (resolveB = r)))();
    });
    createRenderEffect(outlet, () => {});
    return d;
  });
  flush();
  return { setRoute, setVersion, state, resolve: (v: string) => resolveB(v), dispose };
}

it("cancels a recompute the same batch's structural swap orphans", async () => {
  const { setRoute, setVersion, state, resolve, dispose } = setup();
  expect(state.pageRuns).toBe(1);

  // same batch: structural swap away from branch "a" + a write to the
  // orphaned consumer's dependency — atomic, commits only with the transition
  setRoute("b");
  setVersion(1);
  flush();
  expect(state.pageRuns).toBe(1);
  expect(state.seen).toEqual([0]);

  resolve("B");
  await Promise.resolve();
  flush();
  expect(state.pageRuns).toBe(1);

  dispose();
});

it("still updates zombies for mainline writes in a separate flush", async () => {
  const { setRoute, setVersion, state, resolve, dispose } = setup();
  expect(state.pageRuns).toBe(1);

  // park the transition alone
  setRoute("b");
  flush();
  expect(state.pageRuns).toBe(1);

  // independent flush: commits mainline now, so the displayed old tree
  // (the zombie) must reflect it
  setVersion(1);
  flush();
  expect(state.pageRuns).toBe(2);
  expect(state.seen).toEqual([0, 1]);

  resolve("B");
  await Promise.resolve();
  flush();
  expect(state.pageRuns).toBe(2);

  dispose();
});
