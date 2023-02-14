import {
  createRoot,
  getOwner,
  createSignal,
  createEffect,
  createComputed,
  Owner,
  createContext
} from "../src";
import { createStore, unwrap, DEV as STORE_DEV } from "../store/src";

describe("Dev features", () => {
  test("Signals being added to sourceMap with user-provided names", () => {
    createRoot(() => {
      const owner = getOwner()!;
      createSignal(3, { name: "test" });
      createSignal(5);
      createSignal(6, { name: "explicit" });
      expect(owner).toHaveProperty("sourceMap");
      expect(owner.sourceMap![0].name).toBe("test");
      expect(owner.sourceMap![0].value).toBe(3);
      expect(owner.sourceMap![1].name).toBe(undefined);
      expect(owner.sourceMap![1].value).toBe(5);
      expect(owner.sourceMap![2].name).toBe("explicit");
      expect(owner.sourceMap![2].value).toBe(6);
    });
  });

  test("Computations can be named", () => {
    createRoot(() => {
      const owner = getOwner()!;
      createComputed(() => {}, undefined, { name: "test" });
      createEffect(() => {}, undefined, { name: "test_effect" });
      createComputed(() => {});
      createEffect(() => {});
      expect(owner).toHaveProperty("owned");
      expect(owner.owned![0].name).toBe("test");
      expect(owner.owned![1].name).toBe("test_effect");
      expect(owner.owned![2].name).toBe(undefined);
      expect(owner.owned![3].name).toBe(undefined);
    });
  });

  test("Context nodes can be named", () => {
    createRoot(dispose => {
      const ctx1 = createContext(undefined);
      const ctx2 = createContext(undefined, { name: "test" });
      ctx1.Provider({ value: undefined, children: undefined });
      ctx2.Provider({ value: undefined, children: undefined });
      expect(getOwner()!.owned![0].name).toBe(undefined);
      expect(getOwner()!.owned![1].name).toBe("test");
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
