import { describe, expect, it } from "vitest";
import {
  action,
  createRenderEffect,
  createRoot,
  createStore,
  flush,
  reconcile
} from "../../src/index.js";

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => (resolve = r));
  return { promise, resolve };
}

describe("#3743 unchanged presence under an open action", () => {
  it("reconcile reveals an unrelated value while an action holds a deleted key", async () => {
    const gate = deferred();
    const [state, setState] = createStore<{ a: { value: number }; b: { failed?: boolean } }>({
      a: { value: 0 },
      b: { failed: true }
    });
    const values: number[] = [];
    const presence: boolean[] = [];
    createRoot(() => {
      createRenderEffect(
        () => state.a.value,
        v => void values.push(v)
      );
      createRenderEffect(
        () => "failed" in state.b,
        v => void presence.push(v)
      );
    });
    flush();
    expect(values).toEqual([0]);
    expect(presence).toEqual([true]);

    const removeFlag = action(function* removeFlag() {
      setState(d => {
        delete d.b.failed;
      });
      yield gate.promise;
    });
    const p = removeFlag();
    flush();
    expect(values).toEqual([0]);
    expect(presence).toEqual([true]);

    setState(reconcile({ a: { value: 1 }, b: {} }));
    flush();
    expect(values).toEqual([0, 1]);
    expect(presence).toEqual([true]);

    gate.resolve();
    await p;
    flush();
    expect(values).toEqual([0, 1]);
    expect(presence).toEqual([true, false]);
  });

  it("contrast: reconcile restoring the deleted key proposes on the held node and rides the action", async () => {
    const gate = deferred();
    const [state, setState] = createStore<{ a: { value: number }; b: { failed?: boolean } }>({
      a: { value: 0 },
      b: { failed: true }
    });
    const values: number[] = [];
    const presence: boolean[] = [];
    createRoot(() => {
      createRenderEffect(
        () => state.a.value,
        v => void values.push(v)
      );
      createRenderEffect(
        () => "failed" in state.b,
        v => void presence.push(v)
      );
    });
    flush();

    const removeFlag = action(function* removeFlag() {
      setState(d => {
        delete d.b.failed;
      });
      yield gate.promise;
    });
    const p = removeFlag();
    flush();

    setState(reconcile({ a: { value: 1 }, b: { failed: true } }));
    flush();
    expect(values).toEqual([0]);
    expect(presence).toEqual([true]);

    gate.resolve();
    await p;
    flush();
    expect(values).toEqual([0, 1]);
    expect(presence.at(-1)).toBe(true);
    expect("failed" in state.b).toBe(true);
  });
});
