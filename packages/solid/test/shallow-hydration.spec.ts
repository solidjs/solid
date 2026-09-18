/** @vitest-environment jsdom */
import { afterEach, describe, expect, test } from "vitest";
import { createRoot, flush } from "@solidjs/signals";
import {
  enableHydration,
  sharedConfig,
  createStore,
  createOptimisticStore
} from "../src/client/hydration.js";
enableHydration();
function startHydration(data: Record<string, any>) {
  sharedConfig.hydrating = true;
  sharedConfig.has = id => id in data;
  sharedConfig.load = id => data[id];
}
function stopHydration() {
  sharedConfig.hydrating = false;
  sharedConfig.has = undefined;
  sharedConfig.load = undefined;
}

describe("shallow hydration shadows", () => {
  afterEach(stopHydration);
  for (const optimistic of [false, true])
    for (const array of [false, true]) {
      test(`hybrid replay retains raw leaves: optimistic=${optimistic}, array=${array}`, async () => {
        const value = Object.freeze({ key: {}, date: new Date(0), missing: undefined, n: NaN });
        const next = Object.freeze({ ...value, date: new Date(1) });
        const seed: { [key: number]: typeof value | undefined } = array ? [value] : { 0: value };
        startHydration({ t0: { v: seed, s: 1 } });
        let dispose!: () => void;
        const seen: unknown[] = [];
        const [state] = createRoot(
          d => {
            dispose = d;
            return (optimistic ? createOptimisticStore : createStore)(
              async function* (draft) {
                seen.push(draft[0]);
                draft[0] = next;
                yield;
                draft[0] = next;
                yield;
              },
              seed,
              { shallow: true, ssrSource: "hybrid" }
            );
          },
          { id: "t" }
        );
        try {
          flush();
          expect(state[0]).toBe(value);
          stopHydration();
          flush();
          for (let i = 0; i < 30; i++) await Promise.resolve();
          flush();
          expect(seen.length).toBeGreaterThan(0);
          for (const leaf of seen) expect(leaf).toBe(value);
          expect(state[0]).toBe(next);
        } finally {
          dispose();
        }
      });
    }
});
