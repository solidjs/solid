import { describe, expect, test } from "vitest";
import { createDeferred, createRoot, createSignal, flush, refresh, until } from "../src/index.js";

async function settle() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flush();
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

describe("deferred synchronous errors after a superseded flight", () => {
  for (const waiter of ["until", "refresh"] as const) {
    for (const seeded of [false, true]) {
      for (const previousFlight of [false, true]) {
        test(`${waiter}, seed ${seeded}, previous flight ${previousFlight}`, async () => {
          const error = new Error("current request failed");
          const outcomes: unknown[] = [];
          const request = Promise.withResolvers<number>();
          const [step, setStep] = createSignal(0);
          const { value, dispose } = createRoot(dispose => ({
            dispose,
            value: createDeferred(
              () => {
                const current = step();
                if (current === 1) return request.promise;
                if (current === 2) throw error;
                return 7;
              },
              seeded ? { loadingValue: 0 } : undefined
            )
          }));
          try {
            flush();
            if (previousFlight) {
              setStep(1);
              flush();
            }
            setStep(2);
            flush();
            const result = waiter === "until" ? until(value) : refresh(value);
            result.then(
              value => outcomes.push(value),
              reason => outcomes.push(reason)
            );
            await settle();
            expect(outcomes).toHaveLength(1);
            expect(outcomes[0]).toBe(error);
          } finally {
            request.resolve(21);
            await settle();
            dispose();
            flush();
          }
        });
      }
    }
  }
});
