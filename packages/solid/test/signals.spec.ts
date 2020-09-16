import {
  createRoot,
  createSignal,
  createEffect,
  createDeferred,
  createMemo,
  createSelector,
  untrack,
  onCleanup,
  onError
} from "../src";

describe("Create signals", () => {
  test("Create and read a Signal", () => {
    const [value] = createSignal(5);
    expect(value()).toBe(5);
  });
  test("Create and read a Signal with comparator", () => {
    const [value] = createSignal(5, (a, b) => a === b);
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
      const memo = createMemo(i => i + " John", "Hello");
      expect(memo()).toBe("Hello John");
    });
  });
  test("Create an Effect", () => {
    let temp: string;
    createRoot(() => {
      createEffect(() => (temp = "unpure"));
    });
    expect(temp!).toBe("unpure");
  });
});

describe("Update signals", () => {
  test("Create and update a Signal", () => {
    const [value, setValue] = createSignal(5);
    setValue(10);
    expect(value()).toBe(10);
  });
  test("Create Signal with comparator and set different value", () => {
    const [value, setValue] = createSignal(5, (a, b) => a === b);
    setValue(10);
    expect(value()).toBe(10);
  });
  test("Create Signal with comparator and set equivalent value", () => {
    const [value, setValue] = createSignal(5, (a, b) => a > b);
    setValue(3);
    expect(value()).toBe(5);
  });
  test("Create and trigger a Memo", () => {
    createRoot(() => {
      const [name, setName] = createSignal("John"),
        memo = createMemo(() => "Hello " + name());
      expect(memo()).toBe("Hello John");
      setName("Jake");
      expect(memo()).toBe("Hello Jake");
    });
  });
  test("Create and trigger a Memo in an effect", done => {
    createRoot(() => {
      let temp: string;
      const [name, setName] = createSignal("John"),
        memo = createMemo(() => "Hello " + name());
      createEffect(() => (temp = memo() + "!!!"));
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
      createEffect(() => (temp = "unpure " + sign()));
      setTimeout(() => {
        expect(temp).toBe("unpure thoughts");
        setSign("mind");
        expect(temp).toBe("unpure mind");
        done();
      });
    });
  });
});

describe("Untrack signals", () => {
  test("Mute an effect", done => {
    createRoot(() => {
      let temp: string;
      const [sign, setSign] = createSignal("thoughts");
      createEffect(() => (temp = "unpure " + untrack(sign)));
      setTimeout(() => {
        expect(temp).toBe("unpure thoughts");
        setSign("mind");
        expect(temp).toBe("unpure thoughts");
        done();
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
        select = createSelector<number>(
          s,
          (key, value, prevValue) => key === value || key === prevValue
        );
      let count = 0;
      const list = Array.from({ length: 100 }, (_, i) =>
        createMemo(() => {
          count++;
          return select(i) === i ? "selected" : "no";
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
});
