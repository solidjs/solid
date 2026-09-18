import { describe, expect, test } from "vitest";
import {
  createRoot,
  createStore,
  createOptimisticStore,
  flush,
  NotReadyError
} from "../../src/index.js";

describe("shallow loading projections", () => {
  for (const optimistic of [false, true])
    for (const array of [false, true])
      for (const loading of [false, true]) {
        test(`retains raw leaf identity: optimistic=${optimistic}, array=${array}, loading=${loading}`, async () => {
          const original = Object.freeze({
            time: new Date(0),
            missing: undefined,
            n: NaN,
            key: {}
          });
          const replacement = Object.freeze({ ...original, time: new Date(1) });
          let release!: () => void, dispose!: () => void, seen: unknown;
          const gate = new Promise<void>(resolve => {
            release = resolve;
          });
          const seed: { [key: number]: typeof original | undefined } = array
            ? [original]
            : { 0: original };
          const [state] = createRoot(d => {
            dispose = d;
            return (optimistic ? createOptimisticStore : createStore)(
              async draft => {
                seen = draft[0];
                draft[0] = replacement;
                await gate;
              },
              seed,
              { shallow: true, seedLoadingValue: loading }
            );
          });
          try {
            expect(seen).toBe(original);
            if (loading) expect(state[0]).toBe(original);
            else expect(() => state[0]).toThrow(NotReadyError);
            release();
            for (let i = 0; i < 30; i++) await Promise.resolve();
            flush();
            expect(state[0]).toBe(replacement);
          } finally {
            release();
            dispose();
          }
        });
      }
});
