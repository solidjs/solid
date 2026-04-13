import { afterEach, describe, expect, test, vi } from "vitest";
import {
  createRoot,
  createComponent,
  createSignal,
  createStore,
  createMemo,
  createEffect,
  getOwner,
  flush,
  DEV,
  $DEVCOMP,
  type Owner
} from "../src/index.js";

afterEach(() => {
  if (DEV) {
    DEV.hooks.onOwner = undefined;
    DEV.hooks.onGraph = undefined;
    DEV.hooks.onUpdate = undefined;
    DEV.hooks.onStoreNodeUpdate = undefined;
  }
});

describe("devComponent metadata", () => {
  test("createComponent sets consolidated _component object on owner", () => {
    createRoot(() => {
      const props = { greeting: "hello" };
      createComponent(function MyComponent(p: any) {
        const owner = getOwner() as any;
        expect(owner._component).toBeDefined();
        expect(owner._component.fn).toBe(MyComponent);
        expect(owner._component.props).toBe(props);
        expect(owner._component.name).toBe("MyComponent");
        return null;
      }, props);
    });
  });

  test("anonymous component gets empty string name", () => {
    createRoot(() => {
      createComponent((p: any) => {
        const owner = getOwner() as any;
        expect(owner._component.name).toBe("");
        return null;
      }, {});
    });
  });

  test("component owner is transparent (does not shift IDs)", () => {
    const idsWithWrapper: string[] = [];
    const idsWithoutWrapper: string[] = [];

    createRoot(
      () => {
        createComponent(() => {
          const a = createMemo(() => {
            idsWithWrapper.push(getOwner()!.id!);
            return "a";
          });
          a();
          return undefined as any;
        }, {} as any);
      },
      { id: "t" }
    );

    createRoot(
      () => {
        const Comp = () => {
          const a = createMemo(() => {
            idsWithoutWrapper.push(getOwner()!.id!);
            return "a";
          });
          a();
          return undefined as any;
        };
        Comp();
      },
      { id: "t" }
    );

    expect(idsWithWrapper).toEqual(idsWithoutWrapper);
  });
});

describe("$DEVCOMP marking", () => {
  test("devComponent marks component function with $DEVCOMP", () => {
    createRoot(() => {
      function TestComp() {
        return null;
      }
      createComponent(TestComp, {});
      expect($DEVCOMP in TestComp).toBe(true);
      expect((TestComp as any)[$DEVCOMP]).toBe(true);
    });
  });
});

describe("DEV.hooks", () => {
  test("onOwner fires for component owners through createComponent", () => {
    const owners: Owner[] = [];
    DEV!.hooks.onOwner = (o: Owner) => owners.push(o);

    createRoot(() => {
      createComponent(() => null, {});
    });

    // root + transparent component owner + at least the component memo/effect
    expect(owners.length).toBeGreaterThanOrEqual(2);
  });

  test("onGraph fires for signals created inside components", () => {
    const entries: any[] = [];
    DEV!.hooks.onGraph = (value: any, owner: any) => entries.push({ value, owner });

    createRoot(() => {
      createComponent(() => {
        createSignal(42, { name: "count" });
        return null;
      }, {});
    });

    const countEntry = entries.find(e => e.value._name === "count");
    expect(countEntry).toBeDefined();
    expect(countEntry.owner).not.toBeNull();
  });

  test("onGraph fires for stores created inside components", () => {
    const entries: any[] = [];
    DEV!.hooks.onGraph = (value: any, owner: any) => entries.push({ value, owner });

    createRoot(() => {
      createComponent(() => {
        createStore({ count: 0 });
        return null;
      }, {});
    });

    expect(entries.length).toBeGreaterThanOrEqual(1);
  });

  test("onUpdate fires after flush", () => {
    const calls: number[] = [];
    let setCount!: (value: number) => number;
    DEV!.hooks.onUpdate = () => calls.push(1);

    createRoot(() => {
      const [count, _setCount] = createSignal(0);
      setCount = _setCount;
      createEffect(
        () => count(),
        () => {}
      );
      flush();
    });

    const initial = calls.length;
    setCount(1);
    flush();
    expect(calls.length).toBe(initial + 1);
  });

  test("onStoreNodeUpdate fires on store mutation with old/new values", () => {
    const updates: any[] = [];
    DEV!.hooks.onStoreNodeUpdate = (state: any, property: PropertyKey, value: any, prev: any) =>
      updates.push({ state, property, value, prev });

    createRoot(() => {
      const [store, setStore] = createStore({ count: 0, name: "test" });
      setStore(s => {
        s.count = 5;
      });
      flush();

      expect(updates.length).toBe(1);
      expect(updates[0].property).toBe("count");
      expect(updates[0].value).toBe(5);
      expect(updates[0].prev).toBe(0);
    });
  });
});

describe("DEV graph traversal helpers", () => {
  test("getChildren returns child owners", () => {
    createRoot(() => {
      const parent = getOwner()!;
      createMemo(() => 1);
      createMemo(() => 2);
      expect(DEV!.getChildren(parent).length).toBe(2);
    });
  });

  test("getSignals returns signals created in owner", () => {
    createRoot(() => {
      const owner = getOwner()!;
      createSignal(0, { name: "a" });
      createSignal(0, { name: "b" });
      expect(DEV!.getSignals(owner).length).toBe(2);
    });
  });

  test("getParent returns parent owner", () => {
    createRoot(() => {
      const parent = getOwner()!;
      createMemo(() => {
        expect(DEV!.getParent(getOwner()!)).toBe(parent);
        return 0;
      })();
    });
  });

  test("getSources returns computation dependencies", () => {
    createRoot(() => {
      const [a] = createSignal(1);
      const [b] = createSignal(2);
      let memoOwner: any = null;
      const m = createMemo(() => {
        memoOwner = getOwner();
        return a() + b();
      });
      m();
      flush();
      expect(DEV!.getSources(memoOwner!).length).toBe(2);
    });
  });

  test("getObservers returns signal subscribers", () => {
    createRoot(() => {
      const owner = getOwner()!;
      const [a] = createSignal(1);
      const m = createMemo(() => a());
      m();
      flush();
      const signals = DEV!.getSignals(owner);
      expect(DEV!.getObservers(signals[0]).length).toBeGreaterThanOrEqual(1);
    });
  });
});
