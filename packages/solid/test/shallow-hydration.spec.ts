/** @vitest-environment jsdom */
import { describe, expect, test, afterEach } from "vitest";
import { createRoot, createSignal, flush, NotReadyError, refresh } from "@solidjs/signals";
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
const tick = async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
  flush();
};

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

describe("hybrid store takeover", () => {
  afterEach(stopHydration);
  for (const optimistic of [false, true]) {
    test(`waits for the server answer and hydration claim: optimistic=${optimistic}`, async () => {
      let resolve!: (value: { count: number }) => void, dispose!: () => void;
      const server = new Promise<{ count: number }>(r => {
        resolve = r;
      });
      startHydration({ t0: server });
      const [state] = createRoot(
        d => {
          dispose = d;
          return (optimistic ? createOptimisticStore : createStore)(
            async function* (draft) {
              draft.count = 1;
              yield;
              draft.count = 2;
              yield;
            },
            { count: 0 },
            { ssrSource: "hybrid" }
          );
        },
        { id: "t" }
      );
      try {
        flush();
        await tick();
        expect(() => state.count).toThrow(NotReadyError);
        resolve({ count: 1 });
        await tick();
        expect(state.count).toBe(1);
        // More time passing must not let the client supersede this first
        // answer before the delayed server fragment has been claimed.
        await tick();
        expect(state.count).toBe(1);
        stopHydration();
        flush();
        await tick();
        expect(state.count).toBe(2);
      } finally {
        resolve({ count: 1 });
        dispose();
      }
    });
  }
});

describe("hybrid loading values and later questions", () => {
  afterEach(stopHydration);
  for (const optimistic of [false, true]) {
    test(`waits for commit one and keeps later first yields: optimistic=${optimistic}`, async () => {
      let resolve!: (value: { count: number }) => void, dispose!: () => void;
      const server = new Promise<{ count: number }>(r => {
        resolve = r;
      });
      startHydration({ t0: server });
      const [version, update] = createSignal(1);
      const [state] = createRoot(
        d => {
          dispose = d;
          return (optimistic ? createOptimisticStore : createStore)(
            async function* (draft) {
              draft.count = version();
              yield;
            },
            { count: 0 },
            { ssrSource: "hybrid", seedLoadingValue: true }
          );
        },
        { id: "t" }
      );
      try {
        expect(state.count).toBe(0);
        stopHydration();
        flush();
        await tick();
        expect(state.count).toBe(0);
        resolve({ count: 1 });
        await tick();
        await tick();
        expect(state.count).toBe(1);
        update(2);
        flush();
        await tick();
        expect(state.count).toBe(2);
      } finally {
        resolve({ count: 1 });
        dispose();
      }
    });
  }
});

describe("hybrid rejected adoption", () => {
  afterEach(stopHydration);
  test("keeps the server error visible and permits a later explicit refresh", async () => {
    let reject!: (error: Error) => void, dispose!: () => void;
    const server = new Promise<{ count: number }>((_, r) => {
      reject = r;
    });
    startHydration({ t0: server });
    const [state] = createRoot(
      d => {
        dispose = d;
        return createStore(
          async function* (draft) {
            draft.count = 2;
            yield;
          },
          { count: 0 },
          { ssrSource: "hybrid" }
        );
      },
      { id: "t" }
    );
    try {
      const error = new Error("server failed");
      reject(error);
      await tick();
      expect(() => state.count).toThrow(error.message);
      stopHydration();
      flush();
      await tick();
      expect(() => state.count).toThrow(error.message);
      await refresh(state);
      await tick();
      expect(state.count).toBe(2);
    } finally {
      dispose();
    }
  });
});
