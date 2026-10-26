/**
 * #4268 — S-22 row 3′ (D-18) with a fallback that creates a render effect.
 *
 * A re-armed boundary whose fallback reads pending data, and whose content
 * lands first: the fallback is never seen, and the content reveals when it
 * lands. A compiled JSX fallback reads through a render effect (an element
 * plus an `insert`), not in the fallback function itself; that effect sits
 * behind content that is not shown and must hold nothing.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  untrack
} from "../src/index.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const microtask = () => Promise.resolve();

function nested(fallbackEffect: boolean) {
  const [count, setCount] = createSignal(1);
  const log: unknown[] = [];
  let screen: unknown;
  let dispose!: () => void;
  createRoot(d => {
    dispose = d;
    const data = createMemo(async () => {
      const v = count();
      await sleep(1000);
      return v;
    });
    const fallbackData = createMemo(async () => {
      const v = count();
      await sleep(3000);
      return v;
    });
    const fallback = fallbackEffect
      ? () => {
          let t = "loading";
          createRenderEffect(
            () => fallbackData(),
            v => {
              t = `loading ${v}`;
            }
          );
          return t;
        }
      : () => `loading ${fallbackData()}`;
    const inner = untrack(() =>
      createLoadingBoundary(() => `data ${data()}`, fallback, { on: count })
    );
    const outer = untrack(() =>
      createLoadingBoundary(
        () => inner(),
        () => "OUTER FALLBACK"
      )
    );
    createRenderEffect(outer, v => {
      screen = v;
      log.push(v);
    });
  });
  flush();
  return { setCount, screen: () => screen, log, dispose };
}

describe("a re-armed boundary whose fallback reads pending data through a render effect (#4268)", () => {
  for (const fallbackEffect of [false, true]) {
    test(`content lands first: the fallback is never seen (${
      fallbackEffect ? "effect in fallback" : "read in fallback"
    })`, async () => {
      const t = nested(fallbackEffect);
      await vi.advanceTimersByTimeAsync(3000);
      flush();
      expect(t.screen()).toBe("data 1");
      t.log.length = 0;

      t.setCount(2);
      flush();
      await microtask();
      flush();
      expect(t.screen()).toBe("data 1");

      await vi.advanceTimersByTimeAsync(1000);
      flush();
      expect(t.screen()).toBe("data 2");

      await vi.advanceTimersByTimeAsync(2000);
      flush();
      expect(t.screen()).toBe("data 2");
      expect(t.log).toEqual(["data 2"]);
      t.dispose();
    });
  }
});
