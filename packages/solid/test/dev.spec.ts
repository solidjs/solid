import { describe, expect, test, vi } from "vitest";
import {
  createRoot,
  getOwner,
  createSignal,
  createEffect,
  createComputed,
  DEV,
  createContext,
  createComponent,
  onCleanup,
  untrack
} from "../src/index.js";
import type { DevComponent } from "../src/reactive/signal.js";
import { createStore, unwrap, DEV as STORE_DEV } from "../store/src/index.js";

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
    const cb = vi.fn();
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

  test("afterRegisterGraph Hook", () => {
    createRoot(() => {
      const owner = getOwner()!;
      const cb = vi.fn();
      DEV!.hooks.afterRegisterGraph = cb;

      createSignal(1);
      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenLastCalledWith(owner.sourceMap![0]);
      expect(owner.sourceMap).toHaveLength(1);

      createSignal(2, { internal: true });
      expect(cb).toHaveBeenCalledTimes(1);
      expect(owner.sourceMap).toHaveLength(1);

      createStore({});
      expect(cb).toHaveBeenCalledTimes(2);
      expect(cb).toHaveBeenLastCalledWith(owner.sourceMap![1]);
      expect(owner.sourceMap).toHaveLength(2);

      const customValue = { value: 3 };
      DEV!.registerGraph(customValue);
      expect(cb).toHaveBeenCalledTimes(3);
      expect(cb).toHaveBeenLastCalledWith(customValue);
      expect(owner.sourceMap).toHaveLength(3);
    });
  });

  test("OnStoreNodeUpdate Hook", () => {
    const cb = vi.fn();
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

  test("createComponent should create a component owner in DEV", () => {
    createRoot(() => {
      const props = {};
      createComponent(function MyComponent() {
        const owner = getOwner() as DevComponent<{}>;
        expect(owner.name).toBe("MyComponent");
        expect(owner.props).toBe(props);
        expect(owner.component).toBe(MyComponent);
        return null;
      }, props);
    });
  });

  // https://github.com/solidjs/solid/issues/1561
  // The dev-only component wrapper added by `createComponent`/`devComponent`
  // must not change the order in which `onCleanup` callbacks fire on disposal
  // compared to production (where no wrapper exists).
  describe("onCleanup order is consistent with production (#1561)", () => {
    test("cleanups in a component body interleave with sibling cleanups", () => {
      const devOrder: string[] = [];
      createRoot(dispose => {
        onCleanup(() => devOrder.push("before"));
        createComponent(function Child() {
          onCleanup(() => devOrder.push("child"));
          return null;
        }, {});
        onCleanup(() => devOrder.push("after"));
        dispose();
      });

      // Simulate the production code path (no dev wrapper) by calling the
      // component directly under `untrack`, like `createComponent` does in prod.
      const prodOrder: string[] = [];
      createRoot(dispose => {
        onCleanup(() => prodOrder.push("before"));
        untrack(() =>
          (function Child() {
            onCleanup(() => prodOrder.push("child"));
            return null;
          })()
        );
        onCleanup(() => prodOrder.push("after"));
        dispose();
      });

      expect(devOrder).toEqual(prodOrder);
      expect(devOrder).toEqual(["after", "child", "before"]);
    });

    test("nested component cleanups interleave with sibling cleanups", () => {
      const devOrder: string[] = [];
      createRoot(dispose => {
        onCleanup(() => devOrder.push("root-before"));
        createComponent(function Outer() {
          onCleanup(() => devOrder.push("outer-before"));
          createComponent(function Inner() {
            onCleanup(() => devOrder.push("inner"));
            return null;
          }, {});
          onCleanup(() => devOrder.push("outer-after"));
          return null;
        }, {});
        onCleanup(() => devOrder.push("root-after"));
        dispose();
      });

      const prodOrder: string[] = [];
      createRoot(dispose => {
        onCleanup(() => prodOrder.push("root-before"));
        untrack(() =>
          (function Outer() {
            onCleanup(() => prodOrder.push("outer-before"));
            untrack(() =>
              (function Inner() {
                onCleanup(() => prodOrder.push("inner"));
                return null;
              })()
            );
            onCleanup(() => prodOrder.push("outer-after"));
            return null;
          })()
        );
        onCleanup(() => prodOrder.push("root-after"));
        dispose();
      });

      expect(devOrder).toEqual(prodOrder);
      expect(devOrder).toEqual([
        "root-after",
        "outer-after",
        "inner",
        "outer-before",
        "root-before"
      ]);
    });

    test("component cleanups still run when the component is re-created", () => {
      const log: string[] = [];
      let setKey!: (v: number) => void;
      const dispose = createRoot(dispose => {
        const [key, _setKey] = createSignal(0);
        setKey = _setKey;
        createEffect(() => {
          const k = key();
          createComponent(function Child() {
            onCleanup(() => log.push(`cleanup-${k}`));
            return null;
          }, {});
        });
        return dispose;
      });
      // Re-running the effect must dispose the previous component instance and
      // fire its cleanup, even though the cleanup lives on the (persistent) parent.
      setKey(1);
      setKey(2);
      dispose();
      expect(log).toEqual(["cleanup-0", "cleanup-1", "cleanup-2"]);
    });

    test("getOwner inside a component still returns the dev component wrapper", () => {
      createRoot(dispose => {
        const root = getOwner();
        createComponent(function MyComponent() {
          const owner = getOwner() as DevComponent<{}>;
          // owner identity is the dev wrapper, not the parent (preserves devtools)
          expect(owner).not.toBe(root);
          expect(owner.component).toBe(MyComponent);
          expect(owner.owner).toBe(root);
          return null;
        }, {});
        dispose();
      });
    });
  });
});
