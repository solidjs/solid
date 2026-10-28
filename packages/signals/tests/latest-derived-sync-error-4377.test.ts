/**
 * #4377 (D-41, F-6): a memo over `latest(m)` shows `m`'s error as a leaf
 * `latest(m)` does. `m` is sync; the write that makes it throw is staged with
 * the flush, and `latest()` throws the staged error ahead of its commit (the
 * verdict lane's work, shown now). The render effect reading the memo held
 * the error before `m` did, so `<Errored>`, which waits on what threw, let it
 * go as settled; at the commit the leaf re-derived and reached the boundary
 * again, the memo's reader did not (an equal status re-notifies nobody) and
 * kept `m`'s last value. With a held write the same: the leaf shows the
 * error at the reveal, the derivation never did. Fixed by #4364's `prune`
 * change (#4387): a staged error on an error boundary's source keeps the
 * boundary waiting, so the commit that publishes it finds the boundary still
 * waiting on `m`. These pin it.
 */
import { describe, expect, it } from "vitest";
import {
  action,
  createErrorBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  latest
} from "../src/index.js";

const tick = async () => {
  await new Promise(r => setTimeout(r, 0));
  flush();
};

type Shape = "leaf" | "derive" | "derive2" | "plain";

function scene(shape: Shape) {
  const [a, setA] = createSignal(0);
  let screen: unknown;
  createRoot(() => {
    const m = createMemo(() => {
      if (a() === 1) throw new Error("boom");
      return a();
    });
    const d = createMemo(() => latest(m));
    const d2 = createMemo(() => d());
    const read = { leaf: () => latest(m), derive: d, derive2: d2, plain: m }[shape];
    // <Errored fallback="[ERR]"><span>{read()}</span></Errored>
    const out = createErrorBoundary(
      () => {
        createRenderEffect(read, v => void (screen = v));
        return "content";
      },
      () => "[ERR]"
    );
    createRenderEffect(out, v => void (v === "[ERR]" && (screen = v)));
  });
  flush();
  expect(screen).toBe(0);
  return { setA, screen: () => screen };
}

describe("a memo over latest(m) shows m's sync error as the leaf does (#4377)", () => {
  for (const shape of ["leaf", "derive", "derive2", "plain"] as const) {
    it(`${shape}: a plain write`, () => {
      const s = scene(shape);
      s.setA(1);
      flush();
      expect(s.screen()).toBe("[ERR]");
    });

    it(`${shape}: a held write shows the error at the reveal`, async () => {
      const s = scene(shape);
      let release!: () => void;
      action(function* () {
        s.setA(1);
        yield new Promise<void>(r => (release = r));
      })();
      flush();
      await tick();
      expect(s.screen()).toBe(0);
      release();
      await tick();
      await tick();
      expect(s.screen()).toBe("[ERR]");
    });
  }
});
