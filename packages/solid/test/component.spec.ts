import { afterEach, describe, expect, it, test, vi } from "vitest";
import {
  createRoot,
  createComponent,
  createUniqueId,
  createMemo,
  createEffect,
  createSignal,
  createStore,
  untrack,
  flush,
  $DEVCOMP,
  JSX
} from "../src/index.js";

const Comp = (props: { greeting: string; name: string }) => `${props.greeting} ${props.name}`;

describe("CreateComponent", () => {
  test("create simple component", () => {
    createRoot(() => {
      const out = createComponent(Comp, {
        greeting: "Hi",
        get name() {
          return "dynamic";
        }
      });
      expect(out).toBe("Hi dynamic");
    });
  });
  test("null/undefined props are replaced with empty props", () => {
    createRoot(() => {
      const nonObjects = [null, undefined, false];
      nonObjects.forEach(nonObject => {
        const out = createComponent(p => p as JSX.Element, nonObject as any);
        expect(out).toEqual({});
      });
    });
  });
});

describe("Strict Read Warning", () => {
  afterEach(() => flush());

  test("warns on direct signal read in component body", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [count] = createSignal(0);

    createRoot(() => {
      createComponent(() => {
        count();
        return null;
      }, {});
    });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/Reactive value read directly in/i);
    warn.mockRestore();
  });

  test("warns on props.value access backed by signal", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [value] = createSignal(42);

    createRoot(() => {
      createComponent(
        (props: { value: number }) => {
          const v = props.value;
          return null;
        },
        {
          get value() {
            return value();
          }
        }
      );
    });

    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  test("warns on store property destructuring", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    createRoot(() => {
      const [store] = createStore({ count: 0 });
      createComponent(() => {
        const { count } = store;
        return null;
      }, {});
    });

    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  test("does not warn for signal read inside createMemo", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [count] = createSignal(0);

    createRoot(() => {
      createComponent(() => {
        const doubled = createMemo(() => count() * 2);
        return null;
      }, {});
    });
    flush();

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  test("does not warn for signal read inside createEffect", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [count] = createSignal(0);

    createRoot(() => {
      createComponent(() => {
        createEffect(
          () => count(),
          () => {}
        );
        return null;
      }, {});
    });
    flush();

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  test("does not warn with explicit untrack in component body", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [count] = createSignal(0);

    createRoot(() => {
      createComponent(() => {
        untrack(() => count());
        return null;
      }, {});
    });

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  test("nested components each warn independently", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [count] = createSignal(0);

    createRoot(() => {
      createComponent(() => {
        count();
        createComponent(() => {
          count();
          return null;
        }, {});
        return null;
      }, {});
    });

    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  test("warns when component is wrapped by solid-refresh HMR proxy", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [count] = createSignal(0);

    function MyComponent() {
      count();
      return null;
    }

    // Simulate solid-refresh@next createProxy + $$component
    let current: any = MyComponent;
    const [comp] = createSignal(() => current);

    function HMRComp(props: any) {
      const s = untrack(comp);
      if (!s || $DEVCOMP in s) {
        return createMemo(
          () => {
            const c = comp();
            if (c) {
              return untrack(() => c(props), c[$DEVCOMP] && `<${c.name || "Anonymous"}>`);
            }
            return undefined;
          },
          { name: "[solid-refresh]MyComponent", transparent: true }
        );
      }
      return s(props);
    }

    const proxy = new Proxy(HMRComp, {
      get(_, property) {
        if (property === "location" || property === "name")
          return HMRComp[property as keyof typeof HMRComp];
        return (comp() as any)[property];
      },
      set(_, property, value) {
        (comp() as any)[property] = value;
        return true;
      }
    });

    createRoot(() => {
      createComponent(proxy as any, {});
    });

    const strictReadWarns = warn.mock.calls.filter((c: any) =>
      String(c[0]).includes("Reactive value read directly in")
    );
    expect(strictReadWarns.length).toBeGreaterThanOrEqual(1);
    warn.mockRestore();
  });
});

describe("createUniqueId", () => {
  test("creating some", () => {
    const id1 = createUniqueId();
    const id2 = createUniqueId();

    expect(id1).toBeDefined();
    expect(id2).toBeDefined();
    expect(id1).not.toEqual(id2);
  });
});
