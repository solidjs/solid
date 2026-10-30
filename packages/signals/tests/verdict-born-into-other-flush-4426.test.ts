/**
 * #4426: a verdict reader born into a hold `T`, re-run by a flush whose
 * transaction is not `T`, reads `T`'s values (D-25: the hold's own work —
 * a pass born in its world — reads plainly; D-27, A29: a node born into a
 * hold has no screen). `read`'s two deciders disagreed: `frameRead` asked
 * "born into `el`'s hold" and joined the pass, `stagedScreen` asked "born
 * into the flush's transaction" and served the committed value — so the
 * effect a `<Show when={s()}>` content mounted for `s = 3` read `s() === 0`,
 * the value its branch does not exist for.
 *
 * Shape: async-gen seed 3289 #911 —
 * `<Show when={s0()} fallback><span>{isPending(m0)}</span>
 *  <span fx={[s0(), isPending(m0)]} /></Show>`, `m0 = async(latest(s0) + s0)`.
 */
import { expect, it } from "vitest";
import {
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
  flush();
  await new Promise(r => setTimeout(r, 0));
};

it("a verdict reader born into a hold reads the hold's value in another transaction's flush", async () => {
  const flights: { v: number; resolve: (v: number) => void }[] = [];
  const settle = () => {
    while (flights.length) {
      const f = flights.shift()!;
      f.resolve(f.v);
    }
  };
  const [s, setS] = createSignal(3);
  const m = createMemo(
    () =>
      new Promise<number>(resolve => {
        flights.push({ v: 1 + latest(s) + s(), resolve });
      })
  );
  const seen: number[] = [];
  createRoot(() => {
    const out = createLoadingBoundary(
      () => {
        // <Show when={s()} fallback="[F]">
        const value = createMemo(() => s());
        const condition = createMemo(value, { equals: (a, b) => !a === !b, sync: true });
        return createMemo(
          () => {
            if (!condition()) return "[F]";
            createRenderEffect(
              () => isPending(m),
              () => {}
            );
            createRenderEffect(
              () => {
                seen.push(s());
                return isPending(m);
              },
              () => {}
            );
            return "content";
          },
          { sync: true }
        );
      },
      () => "[L]"
    );
    createRenderEffect(
      () => {
        let v: unknown = out;
        while (typeof v === "function") v = v();
        return v;
      },
      () => {}
    );
  });
  flush();
  setS(0);
  flights.shift()!.resolve(7);
  flush();
  seen.length = 0;
  setS(3);
  for (let r = 0; r < 5; r++) {
    for (let i = 0; i < 4; i++) await tick();
    flush();
    settle();
  }
  // The content exists only for a truthy `s`: every pass of its effect reads 3.
  expect(seen.length).toBeGreaterThan(0);
  expect(seen.filter(v => v !== 3)).toEqual([]);
});
