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
    expect(warn.mock.calls[0][0]).toMatch(/Reactive value read at the top level/i);
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
