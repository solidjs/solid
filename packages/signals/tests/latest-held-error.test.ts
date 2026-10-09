import { describe, expect, it } from "vitest";
import {
  createEffect,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest
} from "../src/index.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function settle() {
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  flush();
}

describe("latest of an errored memo held by an async sibling", () => {
  it.each([false, true])(
    "propagates rejection and recovers (async derived: %s)",
    async asyncDerived => {
      let request = deferred<number>();
      let siblingRequest = deferred<number>();
      const failure = new Error("failed");
      const shown: { source?: unknown; derived?: unknown; sibling?: number } = {};
      const [count, setCount] = createSignal(1);
      let source!: () => number;
      let derived!: () => number;
      const dispose = createRoot(dispose => {
        source = createMemo(() => {
          count();
          return request.promise;
        });
        const sibling = createMemo(() => {
          count();
          return siblingRequest.promise;
        });
        derived = createMemo(() => {
          const value = latest(source) + 1;
          return asyncDerived ? Promise.resolve(value) : value;
        });
        createEffect(source, {
          effect: value => {
            shown.source = value;
          },
          error: error => {
            shown.source = error;
          }
        });
        createEffect(derived, {
          effect: value => {
            shown.derived = value;
          },
          error: error => {
            shown.derived = error;
          }
        });
        // A scheduled JSX binding observes the sibling, holding the update.
        createRenderEffect(
          sibling,
          value => {
            shown.sibling = value;
          },
          { schedule: true }
        );
        return dispose;
      });
      try {
        flush();
        request.resolve(1);
        siblingRequest.resolve(1);
        await settle();
        expect(shown).toEqual({ source: 1, derived: 2, sibling: 1 });

        request = deferred<number>();
        siblingRequest = deferred<number>();
        setCount(2);
        flush();
        request.reject(failure);
        await settle();
        siblingRequest.resolve(2);
        await settle();

        // All requests have settled: the latest derivation must not retain
        // its old successful value while the source's settled outcome is error.
        expect(shown.source).toBe(failure);
        expect(shown.sibling).toBe(2);
        expect(() => source()).toThrow("failed");
        expect(() => latest(source)).toThrow("failed");
        expect(isPending(derived)).toBe(false);
        expect(shown.derived).toBe(failure);
        expect(() => derived()).toThrow("failed");

        request = deferred<number>();
        siblingRequest = deferred<number>();
        setCount(3);
        flush();
        request.resolve(3);
        siblingRequest.resolve(3);
        await settle();
        expect(shown).toEqual({ source: 3, derived: 4, sibling: 3 });
        expect(derived()).toBe(4);
        expect(isPending(derived)).toBe(false);
      } finally {
        dispose();
        flush();
      }
    }
  );
});
