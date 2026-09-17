/**
 * REACTIVE_WRITE_IN_OWNED_SCOPE — one rule for both setters (#3500).
 *
 * The guard fires for a write made while the tree is being built or derived:
 * under any owner that is not a children-forbidden reader. Roots are owners
 * like the rest — a `createRoot` body is construction (every dev component
 * body, every context Provider, the top of `render()`, and the whole SSR pass
 * run directly under one), and a write there re-runs what already read the
 * old value, or on the server can't. The store setter used to exempt roots;
 * `setSignal` never did. This pins the same verdict for both, posture by
 * posture, so the two cannot drift apart again.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  createStore,
  createTrackedEffect,
  flush,
  getOwner,
  resetErrorHalt,
  runWithOwner
} from "../src/index.js";

const OWNED = /Writing to reactive state inside an owned scope/;

afterEach(() => {
  resetErrorHalt();
  flush();
});

/** The two setters under test, each writing to a node created with no owner. */
const setters = {
  signal: () => {
    const [, set] = createSignal(0);
    return () => set(1);
  },
  store: () => {
    const [, set] = createStore({ n: 0 });
    return () => set(s => void (s.n = 1));
  }
} as const;

describe("owned-scope write guard: signal and store setters agree", () => {
  for (const [kind, make] of Object.entries(setters)) {
    describe(kind, () => {
      it("allows a write with no owner", () => {
        const write = make();
        expect(write).not.toThrow();
      });

      it("throws in a createRoot body", () => {
        const write = make();
        expect(() => createRoot(write)).toThrow(OWNED);
      });

      it("throws under a root re-entered with runWithOwner", () => {
        // The posture the OBSERVE.exclude docs used to prescribe for panel
        // writes: an owner is an owner however the code got under it.
        const write = make();
        const owner = createRoot(() => getOwner()!);
        expect(() => runWithOwner(owner, write)).toThrow(OWNED);
      });

      it("throws in a root created inside a memo body", () => {
        const write = make();
        const memo = createMemo(() => {
          createRoot(write);
          return 1;
        });
        expect(() => memo()).toThrow(OWNED);
      });

      it("throws in a memo body", () => {
        const write = make();
        const memo = createMemo(() => {
          write();
          return 1;
        });
        expect(() => memo()).toThrow(OWNED);
      });

      it("allows a write from an effect's effect phase", () => {
        const write = make();
        const [tick, setTick] = createSignal(0);
        createRoot(() => {
          createEffect(tick, () => void write());
        });
        flush();
        setTick(1);
        expect(() => flush()).not.toThrow();
      });

      it("allows a write from a children-forbidden reader (createTrackedEffect)", () => {
        const write = make();
        const [tick, setTick] = createSignal(0);
        createRoot(() => {
          createTrackedEffect(() => {
            tick();
            write();
          });
        });
        flush();
        setTick(1);
        expect(() => flush()).not.toThrow();
      });
    });
  }
});
