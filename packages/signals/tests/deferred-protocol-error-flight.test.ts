import { describe, expect, test } from "vitest";
import {
  createDeferred,
  createMemo,
  createRoot,
  createSignal,
  flush,
  isPending,
  refresh,
  until
} from "../src/index.js";

async function settle() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flush();
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

describe("deferred protocol errors release the flight", () => {
  for (const where of ["factory", "next", "async-next"] as const) {
    for (const waiter of ["until", "refresh"] as const) {
      for (const seeded of [false, true]) {
        for (const previousFlight of [false, true]) {
          test(`${where}, ${waiter}, seed ${seeded}, previous flight ${previousFlight}`, async () => {
            const error = new Error("stream failed");
            const old = Promise.withResolvers<number>();
            const outcomes: unknown[] = [];
            const [step, setStep] = createSignal(0);
            const { value, dispose } = createRoot(dispose => ({
              dispose,
              value: createDeferred<number>(
                () => {
                  if (step() === 0) return 0;
                  if (step() === 1) return old.promise;
                  return {
                    [Symbol.asyncIterator]() {
                      if (where === "factory") throw error;
                      return {
                        next() {
                          if (where === "async-next") return Promise.reject(error);
                          throw error;
                        }
                      };
                    }
                  };
                },
                seeded ? { loadingValue: -1 } : undefined
              )
            }));
            try {
              flush();
              expect(value()).toBe(0);
              if (previousFlight) {
                setStep(1);
                flush();
              }
              setStep(2);
              flush();
              const result = waiter === "until" ? until(value) : refresh(value);
              void (async () => {
                try {
                  outcomes.push(await result);
                } catch (reason) {
                  outcomes.push(reason);
                }
              })();
              await settle();
              expect(outcomes).toHaveLength(1);
              expect(outcomes[0]).toBe(error);
              expect(isPending(value)).toBe(false);
              old.resolve(9);
              await settle();
              expect(outcomes).toHaveLength(1);
              expect(outcomes[0]).toBe(error);
              expect(isPending(value)).toBe(false);
            } finally {
              old.resolve(9);
              await settle();
              dispose();
              flush();
            }
          });
        }
      }
    }
  }

  for (const where of ["factory", "next"] as const) {
    test(`NotReady in ${where} still parks until its source answers`, async () => {
      const request = Promise.withResolvers<number>();
      const [step, setStep] = createSignal(0);
      const { value, dispose } = createRoot(dispose => {
        const source = createMemo(() => request.promise);
        const value = createDeferred<number>(() =>
          step() === 0
            ? 0
            : {
                [Symbol.asyncIterator]() {
                  const first = where === "factory" ? source() : undefined;
                  let yielded = false;
                  return {
                    next() {
                      if (yielded) return Promise.resolve({ done: true, value: undefined });
                      const result = where === "factory" ? first! : source();
                      yielded = true;
                      return Promise.resolve({ done: false, value: result });
                    }
                  };
                }
              }
        );
        return { value, dispose };
      });
      try {
        flush();
        expect(value()).toBe(0);
        setStep(1);
        flush();
        expect(value()).toBe(0);
        expect(isPending(value)).toBe(true);
        const answer = until(value);
        request.resolve(7);
        await settle();
        expect(await answer).toBe(7);
        expect(value()).toBe(7);
        expect(isPending(value)).toBe(false);
      } finally {
        request.resolve(7);
        await settle();
        dispose();
        flush();
      }
    });
  }
});
