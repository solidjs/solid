import {
  createRoot,
  createSignal,
  createEffect,
  createDeferred,
  createDependentEffect,
  createMemo,
  freeze,
  sample,
  onCleanup,
  afterEffects,
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
    createRoot(() => {
      let temp;
      createEffect(() => (temp = "unpure"));
      expect(temp).toBe("unpure");
    });
  });
  test("Create an Effect with explicit deps", () => {
    createRoot(() => {
      let temp;
      const [sign] = createSignal("thoughts");
      createDependentEffect(() => (temp = "unpure " + sign()), [sign]);
      expect(temp).toBe("unpure thoughts");
    });
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
  test("Create and trigger a Memo in an effect", () => {
    createRoot(() => {
      let temp;
      const [name, setName] = createSignal("John"),
        memo = createMemo(() => "Hello " + name());
      createEffect(() => (temp = memo() + "!!!"));
      expect(temp).toBe("Hello John!!!");
      setName("Jake");
      expect(temp).toBe("Hello Jake!!!");
    });
  });
  test("Create and trigger an Effect", () => {
    createRoot(() => {
      let temp;
      const [sign, setSign] = createSignal("thoughts");
      createEffect(() => (temp = "unpure " + sign()));
      expect(temp).toBe("unpure thoughts");
      setSign("mind");
      expect(temp).toBe("unpure mind");
    });
  });
  test("Create an Effect trigger explicit deps", () => {
    createRoot(() => {
      let temp;
      const [sign, setSign] = createSignal("thoughts");
      createDependentEffect(() => (temp = "unpure " + sign()), sign);
      expect(temp).toBe("unpure thoughts");
      setSign("mind");
      expect(temp).toBe("unpure mind");
    });
  });
  test("Create an Effect trigger not in explicit deps", () => {
    createRoot(() => {
      let temp;
      const [sign, setSign] = createSignal("thoughts");
      createDependentEffect(() => (temp = "unpure " + sign()), []);
      expect(temp).toBe("unpure thoughts");
      setSign("mind");
      expect(temp).toBe("unpure thoughts");
    });
  });
});

describe("Sample signals", () => {
  test("Mute an effect", () => {
    createRoot(() => {
      let temp;
      const [sign, setSign] = createSignal("thoughts");
      createEffect(() => (temp = "unpure " + sample(sign)));
      expect(temp).toBe("unpure thoughts");
      setSign("mind");
      expect(temp).toBe("unpure thoughts");
    });
  });
});

describe("onCleanup", () => {
  test("Clean an effect", () => {
    createRoot(() => {
      let temp;
      const [sign, setSign] = createSignal("thoughts");
      createEffect(() => {
        sign();
        onCleanup(() => (temp = "after"));
      });
      expect(temp).toBeUndefined();
      setSign("mind");
      expect(temp).toBe("after");
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
      const [s, set] = createSignal(),
        r = createDeferred(s, { timeoutMs: 20 });
      expect(r()).not.toBeDefined();
      set("Hi");
      expect(r()).not.toBeDefined();
      setTimeout(() => {
        expect(r()).toBe("Hi");
        done();
      }, 100);
    });
  });
});

describe("Trigger afterEffects", () => {
  test("Queue up and execute in order", () => {
    let result = "";
    createRoot(() => {
      afterEffects(() => (result += "Hello, "));
      afterEffects(() => (result += "John "));
      afterEffects(() => (result += "Smith!"));
      expect(result).toBe("");
    });
    expect(result).toBe("Hello, John Smith!");
  });

  test("Test when frozen", () => {
    let result = "";
    createRoot(() => {
      freeze(() => {
        afterEffects(() => (result += "Hello, "));
        afterEffects(() => (result += "John "));
        expect(result).toBe("");
      });
      afterEffects(() => (result += "Smith!"));
      expect(result).toBe("Hello, John ");
    });
    expect(result).toBe("Hello, John Smith!");
  });

  test('Queue up and execute when nested', () => {
    let result = ''
    createRoot(() => {
      afterEffects(() => result += 'Hello, ');
      createEffect(() => {
        afterEffects(() => result += 'John ');
        createEffect(() => afterEffects(() => result += 'Smith!'))
      })
      expect(result).toBe("");
    });
    expect(result).toBe('Hello, John Smith!');
  });
});
