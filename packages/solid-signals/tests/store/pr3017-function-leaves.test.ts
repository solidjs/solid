import { describe, expect, test } from "vitest";
import {
  createEffect,
  createRoot,
  createStore,
  flush,
  reconcile,
  createOptimisticStore
} from "../../src/index.js";

describe("#3017: reconcile stores function leaves by identity", () => {
  test("object leaf with live subscriber", () => {
    const [state, setState] = createStore<{ onClick: () => any }>({ onClick: () => "original" });
    createRoot(() => {
      createEffect(
        () => state.onClick,
        () => {}
      );
    });
    flush();
    let called = false;
    const next = () => ((called = true), "next");
    setState(reconcile({ onClick: next }, null));
    flush();
    expect(called).toBe(false);
    expect(state.onClick).toBe(next);
  });

  test("array item with live subscriber", () => {
    const fns = [() => 1, () => 2];
    const [state, setState] = createStore<{ items: Array<() => number> }>({ items: [...fns] });
    createRoot(() => {
      createEffect(
        () => state.items[1],
        () => {}
      );
    });
    flush();
    let called = false;
    const repl = () => ((called = true), 99);
    setState(s => {
      reconcile([fns[0], repl], null)(s.items);
    });
    flush();
    expect(called).toBe(false);
    expect(state.items[1]).toBe(repl);
  });

  test("plain setter write of a function leaf", () => {
    const [state, setState] = createStore<{ cb: () => string }>({ cb: () => "a" });
    createRoot(() => {
      createEffect(
        () => state.cb,
        () => {}
      );
    });
    flush();
    let called = false;
    const next = () => ((called = true), "b");
    setState(s => {
      s.cb = next;
    });
    flush();
    expect(called).toBe(false);
    expect(state.cb).toBe(next);
  });

  test("optimistic store: function leaf behaves exactly like a scalar (never invoked)", () => {
    // Ambient optimistic writes revert at settle (flush end with nothing in
    // flight) — that applies to functions and scalars IDENTICALLY. The #3017
    // invariant here is only that the function is never invoked as an
    // updater, in the draft or at revert.
    const orig = () => "a";
    const [state, setState] = createOptimisticStore<{ cb: () => string; x: number }>({
      cb: orig,
      x: 1
    });
    createRoot(() => {
      createEffect(
        () => [state.cb, state.x],
        () => {}
      );
    });
    flush();
    let called = false;
    const next = () => ((called = true), "b");
    let inDraft: any;
    setState(s => {
      s.cb = next;
      s.x = 2;
      inDraft = s.cb;
    });
    flush();
    expect(called).toBe(false);
    expect(inDraft).toBe(next); // draft read-your-writes serves it by identity
    expect(state.cb).toBe(orig); // reverted at settle — same as…
    expect(state.x).toBe(1); //     …the scalar control
  });
});
