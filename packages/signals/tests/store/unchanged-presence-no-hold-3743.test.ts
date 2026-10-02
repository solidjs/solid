import { describe, expect, it } from "vitest";
import {
  action,
  createProjection,
  createRenderEffect,
  createRoot,
  createSignal,
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

  describe("wide object (overlay draft)", () => {
    const WIDE = 40;
    const wide = () => Object.fromEntries(Array.from({ length: WIDE }, (_, i) => [`k${i}`, i]));

    function setup() {
      const [state, setState] = createStore<{
        a: { value: number };
        b: Record<string, number> & { failed?: boolean };
      }>({ a: { value: 0 }, b: { ...wide(), failed: true } });
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
      setState(d => {
        d.b.k0 = -1;
      });
      flush();
      expect(values).toEqual([0]);
      expect(presence).toEqual([true]);
      return { state, setState, values, presence };
    }

    it("reconcile reveals an unrelated value while an action holds a deleted key", async () => {
      const gate = deferred();
      const { state, setState, values, presence } = setup();
      const removeFlag = action(function* removeFlag() {
        setState(d => {
          delete d.b.failed;
        });
        yield gate.promise;
      });
      const p = removeFlag();
      flush();

      setState(reconcile({ a: { value: 1 }, b: { ...wide(), k0: -1 } }));
      flush();
      expect(values).toEqual([0, 1]);
      expect(presence).toEqual([true]);

      gate.resolve();
      await p;
      flush();
      expect(values).toEqual([0, 1]);
      expect(presence).toEqual([true, false]);
      expect("failed" in state.b).toBe(false);
    });

    it("contrast: reconcile restoring the deleted key proposes on the held node and rides the action", async () => {
      const gate = deferred();
      const { state, setState, values, presence } = setup();
      const removeFlag = action(function* removeFlag() {
        setState(d => {
          delete d.b.failed;
        });
        yield gate.promise;
      });
      const p = removeFlag();
      flush();

      setState(reconcile({ a: { value: 1 }, b: { ...wide(), k0: -1, failed: true } }));
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

  it("a projection adopting away from a chained store still writes presence the inner store changed", () => {
    const [inner, setInner] = createStore<{ k?: number }>({ k: 1 });
    const [mode, setMode] = createSignal<"inner" | "empty" | "plain">("inner");
    const presence: boolean[] = [];
    createRoot(() => {
      const proj = createProjection(
        () => {
          const m = mode();
          return m === "inner" ? inner : m === "empty" ? {} : { k: 1 };
        },
        {} as { k?: number }
      );
      createRenderEffect(
        () => "k" in proj,
        v => void presence.push(v)
      );
    });
    flush();
    expect(presence).toEqual([true]);

    setInner(d => {
      delete d.k;
    });
    flush();
    expect(presence).toEqual([true, false]);

    setMode("empty");
    flush();
    expect(presence.at(-1)).toBe(false);

    setMode("plain");
    flush();
    expect(presence.at(-1)).toBe(true);
  });
});
