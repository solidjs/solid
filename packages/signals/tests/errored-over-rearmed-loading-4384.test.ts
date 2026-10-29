// #4373 follow-up (D-39: a pending is not a value). Shape:
// `<Errored><Loading on={key}>{renderEffect(m1())}</Loading></Errored>`, where m1 is
// an async memo gated by a manually released promise and rejects for s === 1.
// After the error shows, a refetch (setS(2)) in the same flush as a key change
// re-arms the Loading. `arm` hands the Loading's pending readers to it alone
// (B5) by deleting them from outer loading boundaries; an outer error
// boundary keys the same readers but waits on their sources, so it keeps the
// error while m1 is still in flight.
import { expect, it } from "vitest";
import {
  createErrorBoundary,
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flush();
};

it("an Errored over a re-armed Loading keeps the error while the refetch is in flight", async () => {
  const [s, setS] = createSignal(0);
  const [key, setKey] = createSignal(0);
  const gates: Array<() => void> = [];
  let out = "";
  const dispose = createRoot(dispose => {
    const m1 = createMemo(async () => {
      const v = s();
      await new Promise<void>(r => gates.push(r));
      if (v === 1) throw new Error("boom");
      return v;
    });
    const view = createErrorBoundary(
      () =>
        createLoadingBoundary(
          () => {
            createRenderEffect(
              () => m1(),
              () => {}
            );
            return "content";
          },
          () => "[L]",
          { on: () => key() }
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
  gates.shift()!(); // m1 resolves to 0
  await tick();
  expect(out).toBe("content");
  setS(1); // refetch in flight: the Loading has shown content, so it holds
  flush();
  expect(out).toBe("content");
  gates.shift()!(); // m1 rejects
  await tick();
  expect(out).toBe("[E boom]");
  setS(2); // refetch, still gated...
  setKey(1); // ...and the Loading re-arms in the same flush
  flush();
  expect(out).toBe("[E boom]"); // PR head 0104feff: "[L]"
  await tick();
  expect(out).toBe("[E boom]");
  gates.shift()!(); // m1 resolves to 2
  await tick();
  expect(out).toBe("content");
  dispose();
});
