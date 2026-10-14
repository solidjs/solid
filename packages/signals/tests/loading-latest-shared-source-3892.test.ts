/**
 * #3892 — `<Loading on={latest(id)}>` stays on its fallback after the async
 * source it shares with another boundary has settled.
 *
 * Compiled `{data()}` is an insert: the read lives in a child render effect,
 * and the boundary's value is that child (the same value once the fallback
 * ends). A parent render effect inserts each boundary's result. `on:
 * () => latest(id)` shows the fallback now, beside the frame the other
 * boundary holds. When the shared source settles, that parent must apply the
 * child again — a fresh read of the boundary is not enough.
 */
import { afterEach, expect, test } from "vitest";
import {
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  latest
} from "../src/index.js";

afterEach(() => flush());

async function drain() {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve();
    flush();
  }
}

test("Loading on latest leaves its fallback once the shared source settles", async () => {
  let finish!: (value: number) => void;
  const replacement = new Promise<number>(resolve => {
    finish = resolve;
  });
  const [id, setId] = createSignal(0);
  const texts: string[] = [];
  let appliedA: unknown;
  let appliedB: unknown;
  let dispose!: () => void;

  createRoot(d => {
    dispose = d;
    const data = createMemo(() => (id() ? replacement : Promise.resolve(1)));
    const slot = (fallback: string, on?: boolean) => {
      const i = texts.push("") - 1;
      return createLoadingBoundary(
        () => {
          createRenderEffect(
            () => data(),
            v => {
              texts[i] = String(v);
            }
          );
          return i;
        },
        () => fallback,
        on ? { on: () => latest(id) } : undefined
      );
    };
    const armed = slot("fallback", true);
    const plain = slot("kept");
    createRenderEffect(armed, v => {
      appliedA = v;
    });
    createRenderEffect(plain, v => {
      appliedB = v;
    });
  });

  const screen = () =>
    (typeof appliedA === "number" ? texts[appliedA] : appliedA) +
    (typeof appliedB === "number" ? texts[appliedB] : String(appliedB));

  flush();
  await drain();
  expect(screen()).toBe("11");

  setId(1);
  flush();
  await drain();
  // Display-ahead fallback beside the other boundary's previous content.
  expect(screen()).toBe("fallback1");

  finish(2);
  await drain();
  expect(screen()).toBe("22");
  dispose();
});
