/**
 * #3688 — reading an UNCHANGED store property must not hold an independent
 * synchronous update.
 *
 * An action writes `store.saved` and stays pending. A later, separate
 * interaction sets and flushes an independent `enabled` signal. A memo reads
 * `enabled()` and the unchanged `store.stable`. The second update is
 * synchronous and touches nothing the action wrote: it publishes now.
 */
import { describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  isPending,
  latest
} from "../src/index.js";

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => (resolve = r));
  return { promise, resolve };
}

describe("#3688 unchanged store read under an open action", () => {
  it("an independent sync write publishes while an action holds another store key", async () => {
    const gate = deferred();
    const [store, setStore] = createStore({ saved: false, stable: "same" });
    const [enabled, setEnabled] = createSignal(false);
    let derived!: () => boolean;
    const seen: boolean[] = [];
    let pending!: () => boolean;
    createRoot(() => {
      derived = createMemo(() => enabled() && store.stable === "same");
      createRenderEffect(derived, v => void seen.push(v));
      pending = createMemo(() => isPending(enabled));
      createRenderEffect(pending, () => {});
    });
    flush();
    expect(seen).toEqual([false]);

    const save = action(function* save() {
      setStore(s => {
        s.saved = true;
      });
      yield gate.promise;
    });
    const p = save();
    flush();
    expect(derived()).toBe(false);

    // A separate click, unrelated to the action.
    setEnabled(true);
    flush();
    expect(latest(enabled)).toBe(true);
    expect(derived()).toBe(true);
    expect(seen.at(-1)).toBe(true);
    expect(pending()).toBe(false);

    gate.resolve();
    await p;
    flush();
    expect(derived()).toBe(true);
    expect(store.saved).toBe(true);
  });

  it("contrast: reading the key the action WROTE still holds the reader (A29)", async () => {
    const gate = deferred();
    const [store, setStore] = createStore({ saved: false });
    const [enabled, setEnabled] = createSignal(false);
    let derived!: () => boolean;
    let pending!: () => boolean;
    createRoot(() => {
      derived = createMemo(() => enabled() && store.saved);
      createRenderEffect(derived, () => {});
      pending = createMemo(() => isPending(enabled));
      createRenderEffect(pending, () => {});
    });
    flush();
    const save = action(function* save() {
      setStore(s => {
        s.saved = true;
      });
      yield gate.promise;
    });
    const p = save();
    flush();
    setEnabled(true);
    flush();
    // The memo derives from the staged write: it joins the hold, and the
    // independent signal is held with it.
    expect(derived()).toBe(false);
    expect(pending()).toBe(true);
    gate.resolve();
    await p;
    flush();
    expect(derived()).toBe(true);
    expect(pending()).toBe(false);
  });

  it("an untouched key on a deleted-key fold reads committed without holding", async () => {
    const gate = deferred();
    const [store, setStore] = createStore<{ gone?: number; stable: string }>({
      gone: 1,
      stable: "same"
    });
    const [enabled, setEnabled] = createSignal(false);
    let derived!: () => boolean;
    createRoot(() => {
      derived = createMemo(() => enabled() && store.stable === "same");
      createRenderEffect(derived, () => {});
    });
    flush();
    const remove = action(function* remove() {
      setStore(s => {
        delete s.gone;
      });
      yield gate.promise;
    });
    const p = remove();
    flush();
    setEnabled(true);
    flush();
    expect(derived()).toBe(true);
    // The delete itself is still held: mainline sees the committed key.
    expect("gone" in store).toBe(true);
    gate.resolve();
    await p;
    flush();
    expect("gone" in store).toBe(false);
  });

  it("control: the same memo without the store read publishes immediately", async () => {
    const gate = deferred();
    const [store, setStore] = createStore({ saved: false });
    const [enabled, setEnabled] = createSignal(false);
    let derived!: () => boolean;
    createRoot(() => {
      derived = createMemo(() => enabled());
      createRenderEffect(derived, () => {});
    });
    flush();
    const save = action(function* save() {
      setStore(s => {
        s.saved = true;
      });
      yield gate.promise;
    });
    const p = save();
    flush();
    setEnabled(true);
    flush();
    expect(derived()).toBe(true);
    gate.resolve();
    await p;
  });
});
