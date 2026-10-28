// #4364 (D-41, F-12): an error staged on its source is not settled. A memo's
// pass throws in a flush that carries a write, so its error is staged
// (`stageError`) and publishes with the commit. A reader that throws the same
// error during the pass publishes it at once: an uninitialized async memo's
// render effect reading the memo's staged error (it read a node born staged),
// or the memo itself reading it through `latest()` (a verdict lane pass). The
// error reaches `<Errored>` naming the source, whose own error is still only
// staged. The boundary's output pass took that source as settled, dropped it,
// and showed the content: an empty hole under a revealed `<Loading>`, and the
// commit's publish found every reader already holding that error, so nothing
// told the boundary again.
import { expect, it } from "vitest";
import {
  createErrorBoundary,
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  latest,
  untrack
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flush();
};

it.each(["m0() + s()", "latest(m0)", "m0()"])(
  "an uninitialized async memo reading %s reaches <Errored> when its dependency throws",
  async shape => {
    const [s, set] = createSignal(0);
    let release!: (v: unknown) => void;
    const gate = new Promise(r => (release = r));
    let out = "";
    const dispose = createRoot(dispose => {
      const m0 = createMemo(() => {
        if (s() === 2) throw new Error("boom");
        return s();
      });
      const m1 = createMemo(() => {
        const v = shape === "latest(m0)" ? latest(m0) : shape === "m0()" ? m0() : m0() + s();
        return gate.then(() => v);
      });
      // `<Errored><Loading><span>{m1()}</span></Loading></Errored>`
      const view = createErrorBoundary(
        () =>
          createLoadingBoundary(
            () =>
              untrack(() => {
                createRenderEffect(
                  () => m1(),
                  () => {}
                );
                return "content";
              }),
            () => "[L]"
          ),
        (e: () => any) => `[E ${e()?.message}]`
      );
      createRenderEffect(
        () => {
          const v = view();
          return typeof v === "function" ? (v as () => unknown)() : v;
        },
        v => void (out = String(v))
      );
      return dispose;
    });
    flush();
    expect(out).toBe("[L]");
    set(2);
    flush();
    expect(out).toBe("[E boom]");
    release(1);
    await tick();
    expect(out).toBe("[E boom]");
    dispose();
  }
);
