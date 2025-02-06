/** @vitest-environment jsdom */
import { describe, expect, test } from "vitest";
import {
  createRoot,
  createSignal,
  createEffect,
  createRenderEffect,
  createMemo,
  untrack,
  onMount,
  onCleanup,
  createContext,
  useContext,
  getOwner,
  runWithOwner,
  flushSync,
  Setter,
  Accessor
} from "../src/index.js";

describe("Create signals", () => {
  test("Create and read a Signal", () => {
    const [value] = createSignal(5);
    expect(value()).toBe(5);
  });
  test("Create and read a Signal with comparator", () => {
    const [value] = createSignal(5, { equals: (a, b) => a === b });
    expect(value()).toBe(5);
  });
  test("Create and read a Memo", () => {
    createRoot(() => {
      const memo = createMemo(() => "Hello");
      expect(memo()).toBe("Hello");
    });
  });
  test("Create and read a Memo with initial value", () => {
    createRoot(() => {
      const memo = createMemo(i => `${i} John`, "Hello");
      expect(memo()).toBe("Hello John");
    });
  });
  test("Create onMount", () => {
    let temp: string;
    createRoot(() => {
      onMount(() => (temp = "impure"));
    });
    flushSync();
    expect(temp!).toBe("impure");
  });
  test("Create a Effect with explicit deps", () => {
    let temp: string;
    createRoot(() => {
      const [sign] = createSignal("thoughts");
      createEffect(sign, v => {
        temp = `impure ${v}`;
      });
    });
    flushSync();
    expect(temp!).toBe("impure thoughts");
  });
  test("Create a Effect with multiple explicit deps", () => {
    let temp: string;
    createRoot(() => {
      const [sign] = createSignal("thoughts");
      const [num] = createSignal(3);
      createEffect(
        () => [sign(), num()],
        v => {
          temp = `impure ${v[1]}`;
        }
      );
    });
    flushSync();
    expect(temp!).toBe("impure 3");
  });
});

describe("Update signals", () => {
  test("Create and update a Signal", () => {
    const [value, setValue] = createSignal(5);
    setValue(10);
    expect(value()).toBe(10);
  });
  test("Create and update a Signal with fn", () => {
    const [value, setValue] = createSignal(5);
    setValue(p => p + 5);
    expect(value()).toBe(10);
  });
  test("Create Signal and set different value", () => {
    const [value, setValue] = createSignal(5);
    setValue(10);
    expect(value()).toBe(10);
  });
  test("Create Signal and set equivalent value", () => {
    const [value, setValue] = createSignal(5, { equals: (a, b) => a > b });
    setValue(3);
    expect(value()).toBe(5);
  });
  test("Create and read a Signal with function value", () => {
    const [value, setValue] = createSignal<() => string>(() => () => "Hi");
    expect(value()()).toBe("Hi");
    setValue(() => () => "Hello");
    expect(value()()).toBe("Hello");
  });
  test("Create and trigger a Memo", () => {
    createRoot(() => {
      const [name, setName] = createSignal("John"),
        memo = createMemo(() => `Hello ${name()}`);
      expect(memo()).toBe("Hello John");
      setName("Jake");
      expect(memo()).toBe("Hello Jake");
    });
  });
  test("Create Signal and set equivalent value not trigger Memo", () => {
    createRoot(() => {
      const [name, setName] = createSignal("John", { equals: (a, b) => b.startsWith("J") }),
        memo = createMemo(() => `Hello ${name()}`);
      expect(name()).toBe("John");
      expect(memo()).toBe("Hello John");
      setName("Jake");
      flushSync();
      expect(name()).toBe("John");
      expect(memo()).toBe("Hello John");
    });
  });
  test("Create and trigger a Memo in an effect", () => {
    createRoot(() => {
      let temp: string;
      const [name, setName] = createSignal("John"),
        memo = createMemo(() => `Hello ${name()}`);
      createEffect(memo, v => {
        temp = `${v}!!!`;
      });
      flushSync();
      expect(temp!).toBe("Hello John!!!");
      setName("Jake");
      flushSync();
      expect(temp!).toBe("Hello Jake!!!");
    });
  });
  test("Create and trigger an Effect", () => {
    createRoot(() => {
      let temp: string;
      const [sign, setSign] = createSignal("thoughts");
      createEffect(sign, v => {
        temp = `unpure ${v}`;
      });
      flushSync();
      expect(temp!).toBe("unpure thoughts");
      setSign("mind");
      flushSync();
      expect(temp!).toBe("unpure mind");
    });
  });
  test("Create and trigger an Effect with function signals", () => {
    createRoot(() => {
      let temp: string;
      const [sign, setSign] = createSignal<() => string>(() => () => "thoughts");
      createEffect(
        () => sign()(),
        v => {
          temp = `unpure ${v}`;
        }
      );
      flushSync();
      expect(temp!).toBe("unpure thoughts");
      setSign(() => () => "mind");
      flushSync();
      expect(temp!).toBe("unpure mind");
    });
  });

  test("Set signal returns argument", () => {
    const [_, setValue] = createSignal<number>();
    const res1: undefined = setValue(undefined);
    expect(res1).toBe(undefined);
    const res2: number = setValue(12);
    expect(res2).toBe(12);
    const res3 = setValue(Math.random() >= 0 ? 12 : undefined);
    expect(res3).toBe(12);
    const res4 = setValue();
    expect(res4).toBe(undefined);
  });
});

describe("Untrack signals", () => {
  test("Mute an effect", () => {
    createRoot(() => {
      let temp: string;
      const [sign, setSign] = createSignal("thoughts");
      createEffect(
        () => untrack(sign),
        v => {
          temp = `unpure ${v}`;
        }
      );
      flushSync();
      expect(temp!).toBe("unpure thoughts");
      setSign("mind");
      flushSync();
      expect(temp!).toBe("unpure thoughts");
    });
  });
});

describe("Batching signals", () => {
  test("Mute an effect", () => {
    createRoot(() => {
      let temp: string;
      const [sign, setSign] = createSignal("thoughts");
      createEffect(
        () => untrack(sign),
        v => {
          temp = `unpure ${v}`;
        }
      );
      flushSync();
      expect(temp!).toBe("unpure thoughts");
      setSign("mind");
      flushSync();
      expect(temp!).toBe("unpure thoughts");
    });
  });
});

describe("Effect grouping of signals", () => {
  test("Groups updates", () => {
    let count = 0;
    createRoot(() => {
      const [a, setA] = createSignal(0);
      const [b, setB] = createSignal(0);
      createEffect(
        () => {},
        () => {
          setA(1);
          setB(1);
        }
      );
      createEffect(
        () => a() + b(),
        v => {
          count += v;
        }
      );
    });
    expect(count).toBe(0);
    flushSync();
    expect(count).toBe(2);
  });
  test("Groups updates with repeated sets", () => {
    let count = 0;
    createRoot(() => {
      const [a, setA] = createSignal(0);
      createEffect(
        () => {},
        () => {
          setA(1);
          setA(4);
        }
      );
      createEffect(a, v => {
        count += v;
      });
    });
    flushSync();
    expect(count).toBe(4);
  });
  test("Groups updates with fn setSignal", () => {
    let count = 0;
    createRoot(() => {
      const [a, setA] = createSignal(0);
      const [b, setB] = createSignal(0);
      createEffect(
        () => {},
        () => {
          setA(a => a + 1);
          setB(b => b + 1);
        }
      );
      createEffect(
        () => a() + b(),
        v => {
          count += v;
        }
      );
    });
    flushSync();
    expect(count).toBe(2);
  });
  test("Groups updates with fn setSignal with repeated sets", () => {
    let count = 0;
    createRoot(() => {
      const [a, setA] = createSignal(0);
      createEffect(
        () => {},
        () => {
          setA(a => a + 1);
          setA(a => a + 2);
        }
      );
      createEffect(a, v => {
        count += v;
      });
    });
    flushSync();
    expect(count).toBe(3);
  });
  test("Test cross setting in a effect update", () => {
    let count = 0,
      setter: Setter<number>;
    createRoot(() => {
      const [a, setA] = createSignal(1);
      const [b, setB] = createSignal(0);
      setter = setB;
      createEffect(b, b => {
        setA(a => a + b);
      });
      createEffect(a, v => {
        count += v;
      });
    });
    flushSync();
    setter!(b => b + 1);
    flushSync();
    expect(count).toBe(3);
  });
  test("Handles errors gracefully", () =>
    new Promise(done => {
      createRoot(() => {
        let error: Error;
        const [a, setA] = createSignal(0);
        const [b, setB] = createSignal(0);
        createEffect(
          () => {},
          () => {
            try {
              setA(1);
              throw new Error("test");
            } catch (e) {
              error = e as Error;
            }
          }
        );
        createMemo(() => a() + b());
        setTimeout(() => {
          expect(a()).toBe(1);
          expect(b()).toBe(0);
          setA(2);
          expect(a()).toBe(2);
          expect(error).toBeInstanceOf(Error);
          expect(error.message).toBe("test");
          done(undefined);
        }, 0);
      });
    }));

  test("Multiple sets", () =>
    new Promise(done => {
      createRoot(() => {
        let count = 0;
        const [a, setA] = createSignal(0);
        createEffect(
          () => {},
          () => {
            setA(1);
            setA(0);
          }
        );
        createMemo(() => (count = a()));
        setTimeout(() => {
          expect(count).toBe(0);
          done(undefined);
        }, 0);
      });
    }));
});

describe("Typecheck computed and effects", () => {
  test("No default value can return undefined", () => {
    createRoot(() => {
      let count = 0;
      const [sign, setSign] = createSignal("thoughts");
      const fn = (arg?: number) => {
        count++;
        sign();
        expect(arg).toBe(undefined);
        return arg;
      };
      createRenderEffect(fn, () => {});
      createEffect(fn, () => {});
      setTimeout(() => {
        expect(count).toBe(2);
        setSign("update");
        flushSync();
        expect(count).toBe(4);
      }, 0);
    });
  });
  test("Default value never receives undefined", () => {
    createRoot(() => {
      let count = 0;
      const [sign, setSign] = createSignal("thoughts");
      const fn = (arg: number) => {
        count++;
        sign();
        expect(arg).toBe(12);
        return arg;
      };
      createRenderEffect(fn, () => {}, 12);
      createEffect(
        fn,
        () => {},
        () => {},
        12
      );
      setTimeout(() => {
        expect(count).toBe(2);
        setSign("update");
        flushSync();
        expect(count).toBe(4);
      }, 0);
    });
  });
});

describe("onCleanup", () => {
  test("Clean an effect", () => {
    let temp: string, setter: Setter<string>;
    createRoot(() => {
      const [sign, setSign] = createSignal("thoughts");
      setter = setSign;
      createEffect(
        () => {
          sign();
          onCleanup(() => (temp = "after"));
        },
        () => {}
      );
    });
    flushSync();
    expect(temp!).toBeUndefined();
    setter!("mind");
    flushSync();
    expect(temp!).toBe("after");
  });
  test("Explicit root disposal", () => {
    let temp: string | undefined, disposer: () => void;
    createRoot(dispose => {
      disposer = dispose;
      onCleanup(() => (temp = "disposed"));
    });
    expect(temp).toBeUndefined();
    disposer!();
    expect(temp).toBe("disposed");
  });
});

describe("create and use context", () => {
  test("createContext without arguments defaults to undefined and to throw if accessed without provider", () => {
    const context = createContext<number>();
    expect(() => createRoot(() => useContext(context))).toThrow();
  });
});

describe("runWithOwner", () => {
  test("Top level owner execute and disposal", () => {
    let effectRun = false;
    let cleanupRun = false;
    const [owner, dispose] = createRoot(dispose => {
      return [getOwner()!, dispose];
    });

    runWithOwner(owner, () => {
      onMount(() => {
        effectRun = true;
      });
      onCleanup(() => (cleanupRun = true));
      expect(effectRun).toBe(false);
      expect(cleanupRun).toBe(false);
    });
    flushSync();
    expect(effectRun).toBe(true);
    expect(cleanupRun).toBe(false);
    dispose();
    expect(cleanupRun).toBe(true);
  });
});
