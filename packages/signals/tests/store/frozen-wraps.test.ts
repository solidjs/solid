// Core R50: a frozen plain object or array wraps like any other. Stores never
// write to their sources (copy-on-write), so a freeze has nothing to protect,
// and serving a frozen subtree as one opaque leaf made every read under it
// re-run on any change to it. Libraries that freeze their state (XState
// freezes context in dev) stay fine-grained. To keep a value out of tracking,
// use a shallow store (`{ shallow: true }`), not `Object.freeze`.
import { describe, expect, test } from "vitest";
import {
  $TARGET,
  createEffect,
  createRoot,
  createStore,
  flush,
  reconcile,
  snapshot
} from "../../src/index.js";

const deepFreeze = <T>(o: T): T => {
  if (o && typeof o === "object") {
    for (const k of Object.keys(o)) deepFreeze((o as any)[k]);
    Object.freeze(o);
  }
  return o;
};

describe("frozen sources wrap (core R50)", () => {
  test("a frozen nested object is served as a store proxy", () => {
    const data = deepFreeze({ user: { name: "a" }, list: [{ id: 1 }] });
    const [s] = createStore({ data });
    expect((s.data as any)[$TARGET]).toBeDefined();
    expect((s.data.user as any)[$TARGET]).toBeDefined();
    expect((s.data.list[0] as any)[$TARGET]).toBeDefined();
    expect(s.data).not.toBe(data);
    expect(snapshot(s).data).toBe(data);
  });

  test("writes go through the setter and leave the frozen source untouched", () => {
    const data = deepFreeze({ user: { name: "a" }, list: [1, 2] });
    const [s, set] = createStore({ data });
    set(d => {
      d.data.user.name = "b";
      d.data.list.push(3);
    });
    flush();
    expect(s.data.user.name).toBe("b");
    expect([...s.data.list]).toEqual([1, 2, 3]);
    expect(data.user.name).toBe("a");
    expect(data.list).toEqual([1, 2]);
    expect(Object.isFrozen(data.user)).toBe(true);
  });

  test("reconciling frozen snapshots re-runs only the readers of what changed", () => {
    const make = (count: number, label: string) =>
      deepFreeze({ context: { count, meta: { label } }, value: "idle" });
    const [s, set] = createStore(make(0, "x"));
    let countRuns = 0;
    let labelRuns = 0;
    createRoot(() => {
      createEffect(
        () => s.context.count,
        () => void countRuns++
      );
      createEffect(
        () => s.context.meta.label,
        () => void labelRuns++
      );
    });
    flush();
    expect([countRuns, labelRuns]).toEqual([1, 1]);
    set(reconcile(make(1, "x"), null));
    flush();
    expect([countRuns, labelRuns]).toEqual([2, 1]);
    expect(s.context.count).toBe(1);
  });

  test("descriptor and key reads on a frozen array never throw (R51)", () => {
    const [s] = createStore(deepFreeze({ list: [{ id: 1 }, { id: 2 }] }));
    const [root] = createStore(Object.freeze([1, 2]) as number[]);
    for (const arr of [s.list, root] as any[]) {
      expect(Object.getOwnPropertyDescriptor(arr, "length")).toMatchObject({
        value: 2,
        writable: true
      });
      expect(Object.keys(arr)).toEqual(["0", "1"]);
      expect([...arr].length).toBe(2);
    }
  });

  test("shallow keeps frozen values raw: the opt-out for opaque data", () => {
    const blob = deepFreeze({ deep: { x: 1 } });
    const [s] = createStore({ blob }, { shallow: true });
    expect(s.blob).toBe(blob);
    expect(s.blob.deep).toBe(blob.deep);
  });
});
