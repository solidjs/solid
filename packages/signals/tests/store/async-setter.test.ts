/**
 * ASYNC_STORE_SETTER — a store setter is a synchronous transaction.
 *
 * The setter callback's return has one meaning, a replacement root to adopt,
 * and a thenable can never be that. It is the signature of
 * `setStore(async d => …)` (or a sync arrow whose helper is async): only the
 * writes before the first `await` were in the transaction; the rest land on
 * a closed draft and vanish. Dev throws, through the diagnostics channel,
 * for every store family that takes a user setter. Store-specific: a signal
 * may legitimately hold a promise, so `setSignal` has no such rule, and a
 * projection's own async derive is the recompute's business, not the
 * setter's.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  resetErrorHalt,
  OBSERVE
} from "../../src/index.js";

const ASYNC = /\[ASYNC_STORE_SETTER\]/;

afterEach(() => {
  resetErrorHalt();
  flush();
});

const sleep = () => new Promise<void>(r => setTimeout(r, 0));

describe("ASYNC_STORE_SETTER: store setter callbacks are synchronous", () => {
  it("createStore: an async setter callback throws, after its sync writes committed", () => {
    const [store, setStore] = createStore({ n: 0 });
    expect(() =>
      setStore(async d => {
        d.n = 1;
        await sleep();
        d.n = 2;
      })
    ).toThrow(ASYNC);
    // The writes before the first await were real — the transaction closed
    // at the callback's return with them in it, like an effect's side effects
    // ahead of its invalid-cleanup throw.
    flush();
    expect(store.n).toBe(1);
  });

  it("a sync arrow whose helper is async is the same mistake", () => {
    const [, setStore] = createStore({ n: 0 });
    const save = async (d: { n: number }) => {
      await sleep();
      d.n = 2;
    };
    expect(() => setStore(d => save(d) as any)).toThrow(ASYNC);
  });

  it("any thenable counts, not only native promises", () => {
    const [, setStore] = createStore({ n: 0 });
    const thenable = { then: (r: (v: unknown) => void) => r(undefined) };
    expect(() => setStore(() => thenable as any)).toThrow(ASYNC);
  });

  it("createOptimisticStore: same rule on the view's setter", () => {
    const [base] = createStore({ n: 0 });
    const [, setView] = createOptimisticStore(base);
    expect(() =>
      setView(async d => {
        d.n = 1;
      })
    ).toThrow(ASYNC);
  });

  it("derived store (createStore(fn, seed)): same rule on its manual setter", () => {
    const [tick] = createSignal(0);
    const [, setDerived] = createRoot(() =>
      createStore(
        (d: { n: number }) => {
          d.n = tick();
        },
        { n: 0 }
      )
    );
    expect(() =>
      setDerived(async d => {
        d.n = 5;
      })
    ).toThrow(ASYNC);
  });

  it("the throw goes through the diagnostics channel first", () => {
    const capture = OBSERVE!.diagnostics.capture();
    const [, setStore] = createStore({ n: 0 });
    expect(() => setStore(async () => {})).toThrow(ASYNC);
    const events = capture.stop();
    expect(events).toHaveLength(1);
    expect(events[0].code).toBe("ASYNC_STORE_SETTER");
    expect(events[0].kind).toBe("write");
    expect(events[0].severity).toBe("error");
    expect(events[0].data?.operation).toBe("setStore");
  });

  it("a returned replacement object is still adopted (the return's real meaning)", () => {
    const [store, setStore] = createStore({ n: 0 });
    setStore(() => ({ n: 7 }));
    flush();
    expect(store.n).toBe(7);
  });

  it("a projection's own async derive is not the setter's business", async () => {
    let resolve!: (v: { n: number }) => void;
    const seen: number[] = [];
    createRoot(() => {
      const [derived] = createStore(async () => new Promise<{ n: number }>(r => (resolve = r)), {
        n: 0
      });
      createRenderEffect(
        () => derived.n,
        n => void seen.push(n)
      );
    });
    flush();
    resolve({ n: 3 });
    await sleep();
    flush();
    expect(seen).toEqual([3]);
  });
});
