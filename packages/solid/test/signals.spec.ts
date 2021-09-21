import {
  createRoot,
  createSignal,
  createEffect,
  createRenderEffect,
  createComputed,
  createDeferred,
  createMemo,
  createSelector,
  untrack,
  on,
  onMount,
  onCleanup,
  onError,
  createContext,
  useContext
} from "../src";

import "./MessageChannel";

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
    expect(temp!).toBe("impure");
  });
  test("Create a Computed with explicit deps", () => {
    createRoot(() => {
      let temp: string;
      const [sign] = createSignal("thoughts");
      createComputed(on(sign, v => (temp = `impure ${v}`)));
      expect(temp!).toBe("impure thoughts");
    });
  });
  test("Create a Computed with multiple explicit deps", () => {
    createRoot(() => {
      let temp: string;
      const [sign] = createSignal("thoughts");
      const [num] = createSignal(3);
      createComputed(on([sign, num], v => (temp = `impure ${v[1]}`)));
      expect(temp!).toBe("impure 3");
    });
  });
  test("Create a Computed with explicit deps and lazy evaluation", () => {
    createRoot(() => {
      let temp: string;
      const [sign, set] = createSignal("thoughts");
      createComputed(on(sign, v => (temp = `impure ${v}`), { defer: true }));
      expect(temp!).toBeUndefined();
      set("minds");
      expect(temp!).toBe("impure minds");
    });
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
  test("Create and trigger a Memo", () => {
    createRoot(() => {
      const [name, setName] = createSignal("John"),
        memo = createMemo(() => `Hello ${name()}`);
      expect(memo()).toBe("Hello John");
      setName("Jake");
      expect(memo()).toBe("Hello Jake");
    });
  });
  test("Create and trigger a Memo in an effect", done => {
    createRoot(() => {
      let temp: string;
      const [name, setName] = createSignal("John"),
        memo = createMemo(() => `Hello ${name()}`);
      createEffect(() => (temp = `${memo()}!!!`));
      setTimeout(() => {
        expect(temp).toBe("Hello John!!!");
        setName("Jake");
        expect(temp).toBe("Hello Jake!!!");
        done();
      });
    });
  });
  test("Create and trigger an Effect", done => {
    createRoot(() => {
      let temp: string;
      const [sign, setSign] = createSignal("thoughts");
      createEffect(() => (temp = `unpure ${sign()}`));
      setTimeout(() => {
        expect(temp).toBe("unpure thoughts");
        setSign("mind");
        expect(temp).toBe("unpure mind");
        done();
      });
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
  test("Mute an effect", done => {
    createRoot(() => {
      let temp: string;
      const [sign, setSign] = createSignal("thoughts");
      createEffect(() => (temp = `unpure ${untrack(sign)}`));
      setTimeout(() => {
        expect(temp).toBe("unpure thoughts");
        setSign("mind");
        expect(temp).toBe("unpure thoughts");
        done();
      });
    });
  });
});

describe("Batch signals", () => {
  test("Groups updates", done => {
    createRoot(() => {
      let count = 0;
      const [a, setA] = createSignal(0);
      const [b, setB] = createSignal(0);
      createEffect(() => {
        setA(1);
        setB(1);
      });
      createComputed(() => (count = a() + b()));
      setTimeout(() => {
        expect(count).toBe(2);
        done();
      });
    });
  });
  test("Groups updates with repeated sets", done => {
    createRoot(() => {
      let count = 0;
      const [a, setA] = createSignal(0);
      createEffect(() => {
        setA(1);
        setA(4);
      });
      createComputed(() => (count = a()));
      setTimeout(() => {
        expect(count).toBe(4);
        done();
      });
    });
  });
  test("Groups updates with fn setSignal", done => {
    createRoot(() => {
      let count = 0;
      const [a, setA] = createSignal(0);
      const [b, setB] = createSignal(0);
      createEffect(() => {
        setA(a => a + 1);
        setB(b => b + 1);
      });
      createComputed(() => (count = a() + b()));
      setTimeout(() => {
        expect(count).toBe(2);
        done();
      });
    });
  });
  test("Groups updates with fn setSignal with repeated sets", done => {
    createRoot(() => {
      let count = 0;
      const [a, setA] = createSignal(0);
      createEffect(() => {
        setA(a => a + 1);
        setA(a => a + 2);
      });
      createComputed(() => (count = a()));
      setTimeout(() => {
        expect(count).toBe(3);
        done();
      });
    });
  });
  test("Test cross setting in a batched update", done => {
    createRoot(() => {
      let count = 0;
      const [a, setA] = createSignal(1);
      const [b, setB] = createSignal(0);
      createEffect(() => {
        setA(a => a + b());
      });
      createComputed(() => (count = a()));
      setTimeout(() => {
        setB(b => b + 1);
        setTimeout(() => {
          expect(count).toBe(2);
          done();
        });
      });
    });
  });
  test("Handles errors gracefully", done => {
    createRoot(() => {
      let error: Error;
      const [a, setA] = createSignal(0);
      const [b, setB] = createSignal(0);
      createEffect(() => {
        try {
          setA(1);
          throw new Error("test");
          setB(1);
        } catch (e) {
          error = e as Error;
        }
      });
      createComputed(() => a() + b());
      setTimeout(() => {
        expect(a()).toBe(1);
        expect(b()).toBe(0);
        setA(2);
        expect(a()).toBe(2);
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toBe("test");
        done();
      });
    });
  });
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
      createComputed(fn);
      createRenderEffect(fn);
      createEffect(fn);
      setTimeout(() => {
        expect(count).toBe(3);
        setSign("update");
        expect(count).toBe(6);
      });
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
      createComputed(fn, 12);
      createRenderEffect(fn, 12);
      createEffect(fn, 12);
      setTimeout(() => {
        expect(count).toBe(3);
        setSign("update");
        expect(count).toBe(6);
      });
    });
  });
});

describe("onCleanup", () => {
  test("Clean an effect", done => {
    createRoot(() => {
      let temp: string;
      const [sign, setSign] = createSignal("thoughts");
      createEffect(() => {
        sign();
        onCleanup(() => (temp = "after"));
      });
      setTimeout(() => {
        expect(temp).toBeUndefined();
        setSign("mind");
        expect(temp).toBe("after");
        done();
      });
    });
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

describe("onError", () => {
  test("No Handler", () => {
    expect(() =>
      createRoot(() => {
        throw "fail";
      })
    ).toThrow("fail");
  });
  test("Top level", () => {
    let errored = false;
    expect(() =>
      createRoot(() => {
        onError(() => (errored = true));
        throw "fail";
      })
    ).not.toThrow("fail");
    expect(errored).toBe(true);
  });

  test("In initial effect", () => {
    let errored = false;
    expect(() =>
      createRoot(() => {
        createEffect(() => {
          onError(() => (errored = true));
          throw "fail";
        });
      })
    ).not.toThrow("fail");
    expect(errored).toBe(true);
  });

  test("With multiple error handlers", () => {
    let errored = false;
    let errored2 = false;
    expect(() =>
      createRoot(() => {
        createEffect(() => {
          onError(() => (errored = true));
          onError(() => (errored2 = true));
          throw "fail";
        });
      })
    ).not.toThrow("fail");
    expect(errored).toBe(true);
    expect(errored2).toBe(true);
  });

  test("In update effect", () => {
    let errored = false;
    expect(() =>
      createRoot(() => {
        const [s, set] = createSignal(0);
        createEffect(() => {
          const v = s();
          onError(() => (errored = true));
          if (v) throw "fail";
        });
        set(1);
      })
    ).not.toThrow("fail");
    expect(errored).toBe(true);
  });

  test("In initial nested effect", () => {
    let errored = false;
    expect(() =>
      createRoot(() => {
        createEffect(() => {
          createEffect(() => {
            onError(() => (errored = true));
            throw "fail";
          });
        });
      })
    ).not.toThrow("fail");
    expect(errored).toBe(true);
  });

  test("In nested update effect", () => {
    let errored = false;
    expect(() =>
      createRoot(() => {
        const [s, set] = createSignal(0);
        createEffect(() => {
          createEffect(() => {
            const v = s();
            onError(() => (errored = true));
            if (v) throw "fail";
          });
        });
        set(1);
      })
    ).not.toThrow("fail");
    expect(errored).toBe(true);
  });

  test("In nested update effect different levels", () => {
    let errored = false;
    expect(() =>
      createRoot(() => {
        const [s, set] = createSignal(0);
        createEffect(() => {
          onError(() => (errored = true));
          createEffect(() => {
            const v = s();
            if (v) throw "fail";
          });
        });
        set(1);
      })
    ).not.toThrow("fail");
    expect(errored).toBe(true);
  });
});

describe("createDeferred", () => {
  test("simple defer", done => {
    createRoot(() => {
      const [s, set] = createSignal("init"),
        r = createDeferred(s, { timeoutMs: 20 });
      expect(r()).toBe("init");
      set("Hi");
      expect(r()).toBe("init");
      setTimeout(() => {
        expect(r()).toBe("Hi");
        done();
      }, 100);
    });
  });
});

describe("createSelector", () => {
  test("simple selection", done => {
    createRoot(() => {
      const [s, set] = createSignal<number>(-1),
        isSelected = createSelector<number, number>(s);
      let count = 0;
      const list = Array.from({ length: 100 }, (_, i) =>
        createMemo(() => {
          count++;
          return isSelected(i) ? "selected" : "no";
        })
      );
      expect(count).toBe(100);
      expect(list[3]()).toBe("no");
      setTimeout(() => {
        count = 0;
        set(3);
        expect(count).toBe(1);
        expect(list[3]()).toBe("selected");
        count = 0;
        set(6);
        expect(count).toBe(2);
        expect(list[3]()).toBe("no");
        expect(list[6]()).toBe("selected");
        done();
      });
    });
  });

  test("double selection", done => {
    createRoot(() => {
      const [s, set] = createSignal<number>(-1),
        isSelected = createSelector<number, number>(s);
      let count = 0;
      const list = Array.from({ length: 100 }, (_, i) => [
        createMemo(() => {
          count++;
          return isSelected(i) ? "selected" : "no";
        }),
        createMemo(() => {
          count++;
          return isSelected(i) ? "oui" : "non";
        })
      ]);
      expect(count).toBe(200);
      expect(list[3][0]()).toBe("no");
      expect(list[3][1]()).toBe("non");
      setTimeout(() => {
        count = 0;
        set(3);
        expect(count).toBe(2);
        expect(list[3][0]()).toBe("selected");
        expect(list[3][1]()).toBe("oui");
        count = 0;
        set(6);
        expect(count).toBe(4);
        expect(list[3][0]()).toBe("no");
        expect(list[6][0]()).toBe("selected");
        expect(list[3][1]()).toBe("non");
        expect(list[6][1]()).toBe("oui");
        done();
      });
    });
  });

  test("zero index", done => {
    createRoot(() => {
      const [s, set] = createSignal<number>(-1),
        isSelected = createSelector<number, number>(s);
      let count = 0;
      const list = [
        createMemo(() => {
          count++;
          return isSelected(0) ? "selected" : "no";
        })
      ];
      expect(count).toBe(1);
      expect(list[0]()).toBe("no");
      setTimeout(() => {
        count = 0;
        set(0);
        expect(count).toBe(1);
        expect(list[0]()).toBe("selected");
        count = 0;
        set(-1);
        expect(count).toBe(1);
        expect(list[0]()).toBe("no");
        done();
      });
    });
  });
});

describe("create and use context", () => {
  test("createContext without arguments defaults to undefined", () => {
    const context = createContext<number>();
    const res = useContext(context);
    expect(res).toBe<typeof res>(undefined);
  });
});
