/**
 * #2898 — an optimistic write of literal `undefined` must not collide with
 * the no-override sentinel. `_overrideValue` doubles as the optimistic-node
 * brand (`undefined` = not optimistic, NOT_PENDING = at rest), so storing the
 * raw value erased the node's optimistic identity: the write was invisible to
 * readers, and a follow-up optimistic write was routed off the optimistic
 * path and committed permanently (no rollback at settle). Store deletes,
 * set-to-undefined, and the filter() removal shape all funnel into it.
 *
 * The fix stores the OVERRIDE_UNDEFINED stand-in (NO_SNAPSHOT pattern) and
 * unwraps at every site that surfaces the override VALUE; slot identity
 * tests stay raw.
 */
import {
  action,
  createOptimistic,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  flush,
  isPending,
  latest
} from "../src/index.js";

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => (resolve = r));
  return { promise, resolve };
}

describe("#2898 optimistic literal undefined", () => {
  it("1: optimistic undefined is visible during the action window", async () => {
    const gate = deferred();
    const [v, setV] = createOptimistic<string | undefined>("a");
    createRoot(() => {
      createRenderEffect(
        () => v(),
        () => {}
      );
    });
    flush();
    const act = action(function* () {
      setV(undefined);
      yield gate.promise;
    });
    const p = act();
    flush();
    expect(v()).toBe(undefined);
    gate.resolve();
    await p;
    flush();
    expect(v()).toBe("a");
  });

  it("1b: verdict channels see the undefined override (latest/isPending)", async () => {
    const gate = deferred();
    const [v, setV] = createOptimistic<string | undefined>("a");
    createRoot(() => {
      createRenderEffect(
        () => v(),
        () => {}
      );
    });
    flush();
    const act = action(function* () {
      setV(undefined);
      yield gate.promise;
    });
    const p = act();
    flush();
    // A17: the override IS the value on every channel, undefined included.
    expect(latest(() => v())).toBe(undefined);
    // A24: an optimistic write is verdict-inert on its own slot.
    expect(isPending(() => v())).toBe(false);
    gate.resolve();
    await p;
    flush();
    expect(v()).toBe("a");
  });

  it("2: follow-up write reverts at settle (no permanent commit)", async () => {
    const gate = deferred();
    const [v, setV] = createOptimistic<string | undefined>("a");
    createRoot(() => {
      createRenderEffect(
        () => v(),
        () => {}
      );
    });
    flush();
    const act = action(function* () {
      setV(undefined);
      setV("b");
      yield gate.promise;
    });
    const p = act();
    flush();
    expect(v()).toBe("b");
    gate.resolve();
    await p;
    flush();
    expect(v()).toBe("a");
  });

  it("3: optimistic store filter-removal reverts at settle", async () => {
    const gate = deferred();
    const [todos, setTodos] = createOptimisticStore<{ id: number }[]>([
      { id: 1 },
      { id: 2 },
      { id: 3 }
    ]);
    createRoot(() => {
      createRenderEffect(
        () => todos.length,
        () => {}
      );
    });
    flush();
    const act = action(function* () {
      setTodos(t => t.filter(x => x.id !== 2));
      yield gate.promise;
    });
    const p = act();
    flush();
    expect(todos.map(t => t.id)).toEqual([1, 3]);
    gate.resolve();
    await p;
    flush();
    expect(todos.map(t => t.id)).toEqual([1, 2, 3]);
  });

  it("4: optimistic store set-to-undefined is visible then reverts", async () => {
    const gate = deferred();
    const [s, setS] = createOptimisticStore<{ a?: number }>({ a: 1 });
    createRoot(() => {
      createRenderEffect(
        () => s.a,
        () => {}
      );
    });
    flush();
    const act = action(function* () {
      setS(d => {
        d.a = undefined;
      });
      yield gate.promise;
    });
    const p = act();
    flush();
    expect(s.a).toBe(undefined);
    gate.resolve();
    await p;
    flush();
    expect(s.a).toBe(1);
  });

  it("5: optimistic store delete is visible then reverts", async () => {
    const gate = deferred();
    const [s, setS] = createOptimisticStore<{ a?: number }>({ a: 1 });
    createRoot(() => {
      createRenderEffect(
        () => s.a,
        () => {}
      );
    });
    flush();
    const act = action(function* () {
      setS(d => {
        delete d.a;
      });
      yield gate.promise;
    });
    const p = act();
    flush();
    expect(s.a).toBe(undefined);
    expect("a" in s).toBe(false);
    gate.resolve();
    await p;
    flush();
    expect(s.a).toBe(1);
    expect("a" in s).toBe(true);
  });
});
