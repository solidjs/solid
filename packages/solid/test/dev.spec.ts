import {
  createRoot,
  getOwner,
  createSignal,
  createEffect,
  createComponent,
  createComputed,
  DEV,
  Owner,
  createContext
} from "../src";
import { createStore, unwrap, DEV as STORE_DEV } from "../store/src";

describe("Dev features", () => {
  test("Reactive graph serialization", () => {
    let owner: ReturnType<typeof getOwner>, set1: (v: number) => number, setState1: any;

    const SNAPSHOTS = [
      `{"s1773325850":5,"s1773325850-1":5,"c-1":{"explicit":6},"CustomComponent:c-2":{"s533736025":{"firstName":"John","lastName":"Smith"}}}`,
      `{"s1773325850":7,"s1773325850-1":5,"c-1":{"explicit":6},"CustomComponent:c-2":{"s533736025":{"firstName":"Matt","lastName":"Smith","middleInitial":"R."}}}`
    ];
    const CustomComponent = () => {
      const [state, setState] = createStore({ firstName: "John", lastName: "Smith" });
      setState1 = setState;
      return "";
    };
    createRoot(() => {
      owner = getOwner();
      const [s, set] = createSignal(5);
      const [s2] = createSignal(5);
      createEffect(() => {
        const [s] = createSignal(6, { name: "explicit" });
      });
      createComponent(CustomComponent, {});
      set1 = set;
    });
    expect(JSON.stringify(DEV!.serializeGraph(owner!))).toBe(SNAPSHOTS[0]);
    set1!(7);
    setState1({ middleInitial: "R.", firstName: "Matt" });
    expect(JSON.stringify(DEV!.serializeGraph(owner!))).toBe(SNAPSHOTS[1]);
  });

  test("Context nodes can be named", () => {
    createRoot(dispose => {
      const ctx = createContext(undefined, { name: "test" });
      ctx.Provider({ value: undefined, children: undefined });
      const ctxNode = getOwner()!.owned![0];
      expect(ctxNode.name).toBe("test");
      dispose();
    });
  });

  test("AfterUpdate Hook", () => {
    let triggered = 0;
    let set1: (v: number) => number, setState1: any;
    DEV!.hooks.afterUpdate = () => triggered++;
    createRoot(() => {
      const [s, set] = createSignal(5);
      const [s2] = createSignal(5);
      createEffect(() => {
        const [s] = createSignal(6, { name: "explicit" });
      });
      const [state, setState] = createStore({ firstName: "John", lastName: "Smith" });
      createEffect(() => {
        s();
        s2();
        state.firstName;
      });
      set1 = set;
      setState1 = setState;
    });
    expect(triggered).toBe(1);
    set1!(7);
    expect(triggered).toBe(2);
    setState1({ middleInitial: "R.", firstName: "Matt" });
    expect(triggered).toBe(3);
  });

  test("AfterUpdate Hook with effect write", () => {
    let triggered = 0;
    let set1: (v: number) => number;
    let log = "";
    DEV!.hooks.afterUpdate = () => triggered++;
    createRoot(() => {
      const [s, set] = createSignal(5);
      const [s2, set2] = createSignal(0);
      const [s3, set3] = createSignal(0);
      createComputed(() => {
        log += "a";
        set3(s2());
      });
      createEffect(() => {
        log += "b";
        set2(s());
      });
      createEffect(() => {
        log += "c";
        s3();
      });
      set1 = set;
    });
    expect(triggered).toBe(1);
    expect(log).toBe("abcac");
    log = "";
    set1!(7);
    expect(triggered).toBe(2);
    expect(log).toBe("bac");
  });

  test("afterCreateOwner Hook", () => {
    const cb = jest.fn();
    DEV!.hooks.afterCreateOwner = cb;
    createRoot(() => {
      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenLastCalledWith(getOwner());
      createRoot(_ => {
        expect(cb).toHaveBeenCalledTimes(2);
        expect(cb).toHaveBeenLastCalledWith(getOwner());
      });
      createComputed(() => {
        expect(cb).toHaveBeenCalledTimes(3);
        expect(cb).toHaveBeenLastCalledWith(getOwner());
      });
    });
  });

  test("OnStoreNodeUpdate Hook", () => {
    const cb = jest.fn();
    STORE_DEV!.hooks.onStoreNodeUpdate = cb;
    const [s, set] = createStore({ firstName: "John", lastName: "Smith", inner: { foo: 1 } });
    expect(cb).toHaveBeenCalledTimes(0);
    set({ firstName: "Matt" });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(unwrap(s), "firstName", "Matt", "John");
    set("inner", "foo", 2);
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb).toHaveBeenCalledWith(unwrap(s.inner), "foo", 2, 1);
  });
});
