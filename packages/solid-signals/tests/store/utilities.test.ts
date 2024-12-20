import {
  createEffect,
  createRoot,
  createSignal,
  createStore,
  flushSync,
  merge,
  omit
} from "../../src/index.js";

type SimplePropTypes = {
  a?: string | null;
  b?: string | null;
  c?: string | null;
  d?: string | null;
};

const Comp2 = (props: { greeting: string; name: string; optional?: string }) => {
  const q = omit(props, "greeting", "optional");
  expect((q as any).greeting).toBeUndefined();
  return `${props.greeting} ${q.name}`;
};

describe("merge", () => {
  test("falsey values", () => {
    let props: SimplePropTypes = {
      get a() {
        return "ji";
      },
      b: null,
      c: "j"
    };
    props = merge(props, false, null, undefined);
    expect(props.a).toBe("ji");
    expect(props.b).toBe(null);
    expect(props.c).toBe("j");
  });
  it("overrides undefined values", () => {
    let bValue: number | undefined;
    const a = { value: 1 };
    const b = {
      get value() {
        return bValue;
      }
    };
    const c = {
      get value() {
        return undefined;
      }
    };
    const d = { value: undefined };
    const props = merge(a, b, c, d);
    expect(props.value).toBe(undefined);
    bValue = 2;
    expect(props.value).toBe(undefined);
  });
  it("includes undefined property", () => {
    const value = { a: undefined };
    const getter = {
      get a() {
        return undefined;
      }
    };
    expect("a" in merge(value)).toBeTruthy();
    expect("a" in merge(getter)).toBeTruthy();
    expect("a" in merge(value, getter)).toBeTruthy();
    expect("a" in merge(getter, value)).toBeTruthy();
  });
  it("doesn't keep references for non-getters", () => {
    const a = { value1: 1 };
    const b = { value2: 2 };
    const props = merge(a, b);
    a.value1 = b.value2 = 3;
    expect(props.value1).toBe(1);
    expect(props.value2).toBe(2);
    expect(Object.keys(props).join()).toBe("value1,value2");
  });
  it("without getter transfers only value", () => {
    const a = { value1: 1 };
    const b = {
      get value2() {
        return undefined;
      }
    };
    const props = merge(a, b);
    a.value1 = 3;
    expect(props.value1).toBe(1);
    expect(Object.keys(props).join()).toBe("value1,value2");
  });
  it("overrides enumerables", () => {
    const a = Object.defineProperties(
      {},
      {
        value1: {
          enumerable: false,
          value: 2
        }
      }
    );
    const props = merge(a, {});
    expect((props as any).value1).toBe(2);
    expect(Object.getOwnPropertyDescriptor(props, "value1")?.enumerable).toBeTruthy();
    expect(Object.keys(props).join()).toBe("value1");
  });
  it("does not write the target", () => {
    const props = { value1: 1 };
    merge(props, {
      value2: 2,
      get value3() {
        return 3;
      }
    });
    expect(Object.keys(props).join("")).toBe("value1");
  });
  it("returns same reference when only one argument", () => {
    const props = {};
    const newProps = merge(props);
    expect(props === newProps).toBeTruthy();
  });
  it("returns same reference with trailing falsy arguements", () => {
    const props = {};
    const newProps = merge(props, null, undefined);
    expect(props === newProps).toBeTruthy();
  });
  it("returns same reference when all keys are covered", () => {
    const props = { a: 1, b: 2 };
    const newProps = merge({ a: 2 }, { b: 2 }, props);
    expect(props === newProps).toBeTruthy();
  })
  it("returns new reference when all keys are not covered", () => {
    const props = { a: 1 };
    const newProps = merge({ a: 2 }, { b: 2 }, props);
    expect(props === newProps).toBeFalsy();
  })
  it("uses the source instances", () => {
    const source1 = {
      get a() {
        return this;
      }
    };
    const source2 = {
      get b() {
        return this;
      }
    };
    const props = merge(source1, source2);
    expect(props.a === source1).toBeTruthy();
    expect(props.b === source2).toBeTruthy();
  });
  it("does not clone nested objects", () => {
    const b = { value: 1 };
    const props = merge({ a: 1 }, { b });
    b.value = 2;
    expect(props.b.value).toBe(2);
  });
  it("handles undefined values", () => {
    const props = merge({ a: 1 }, { a: undefined });
    expect(props.a).toBe(undefined);
  });
  it("handles null values", () => {
    const props = merge({ a: 1 }, { a: null });
    expect(props.a).toBeNull();
  });
  it("contains null values", () => {
    const props = merge({
      a: null,
      get b() {
        return null;
      }
    });
    expect(props.a).toBeNull();
    expect(props.b).toBeNull();
  });
  it("contains undefined values", () => {
    const props = merge({
      a: undefined,
      get b() {
        return undefined;
      }
    });
    expect(Object.keys(props).join()).toBe("a,b");
    expect("a" in props).toBeTruthy();
    expect("b" in props).toBeTruthy();
    expect(props.a).toBeUndefined();
    expect(props.b).toBeUndefined();
  });
  it("ignores falsy sources", () => {
    const props = merge(undefined, null, { value: 1 }, null, undefined);
    expect(Object.keys(props).join()).toBe("value");
  });
  it("fails with non objects sources", () => {
    expect(() => merge({ value: 1 }, true)).toThrowError();
    expect(() => merge({ value: 1 }, 1)).toThrowError();
  });
  it("works with a array source", () => {
    const props = merge({ value: 1 }, [2]);
    expect(Object.keys(props).join()).toBe("0,value,length");
    expect(props.value).toBe(1);
    expect(props.length).toBe(1);
    expect(props[0]).toBe(2);
  });
  it("is safe", () => {
    merge({}, JSON.parse('{ "__proto__": { "evil": true } }'));
    expect(({} as any).evil).toBeUndefined();
    merge({}, JSON.parse('{ "prototype": { "evil": true } }'));
    expect(({} as any).evil).toBeUndefined();
    merge({ value: 1 }, JSON.parse('{ "__proto__": { "evil": true } }'));
    expect(({} as any).evil).toBeUndefined();
    merge({ value: 1 }, JSON.parse('{ "prototype": { "evil": true } }'));
    expect(({} as any).evil).toBeUndefined();
  });
  it("sets already prototyped properties", () => {
    expect(merge({ toString: 1 }).toString).toBe(1);
    expect({}.toString).toBeTypeOf("function");
  });
});

describe("Set Default Props", () => {
  test("simple set", () => {
    let props: SimplePropTypes = {
        get a() {
          return "ji";
        },
        b: null,
        c: "j"
      },
      defaults: SimplePropTypes = { a: "yy", b: "ggg", d: "DD" };
    props = merge(defaults, props);
    expect(props.a).toBe("ji");
    expect(props.b).toBe(null);
    expect(props.c).toBe("j");
    expect(props.d).toBe("DD");
  });
});

describe("Clone Props", () => {
  test("simple set", () => {
    let reactive = false;
    const props: SimplePropTypes = {
      get a() {
        reactive = true;
        return "ji";
      },
      b: null,
      c: "j"
    };
    const newProps = merge(props, {});
    expect(reactive).toBe(false);
    expect(newProps.a).toBe("ji");
    expect(reactive).toBe(true);
    expect(newProps.b).toBe(null);
    expect(newProps.c).toBe("j");
    expect(newProps.d).toBe(undefined);
  });
});

describe("Clone Store", () => {
  test("simple set", () => {
    const [state, setState] = createStore<{ a: string; b: string; c?: string }>({
      a: "Hi",
      b: "Jo"
    });
    const clone = merge(state, {});
    expect(state === clone).toBeFalsy();
    expect(clone.a).toBe("Hi");
    expect(clone.b).toBe("Jo");
    setState(v => {
      v.a = "Greetings";
      v.c = "John";
    });
    expect(clone.a).toBe("Greetings");
    expect(clone.b).toBe("Jo");
    expect(clone.c).toBe("John");
  });
  it("returns same reference when only one argument", () => {
    const [state, setState] = createStore<{ a: string; b: string; c?: string }>({
      a: "Hi",
      b: "Jo"
    });
    const clone = merge(state);
    expect(state === clone).toBeTruthy();
  });
});

describe("Merge Signal", () => {
  test("simple set", () => {
    const [s, set] = createSignal<SimplePropTypes>({
        get a() {
          return "ji";
        },
        b: null,
        c: "j"
      }),
      defaults: SimplePropTypes = { a: "yy", b: "ggg", d: "DD" };
    let props!: SimplePropTypes;
    const res: string[] = [];
    createRoot(() => {
      props = merge(defaults, s);
      createEffect(
        () => props.a as string,
        v => {
          res.push(v);
        }
      );
    });
    flushSync();
    expect(props.a).toBe("ji");
    expect(props.b).toBe(null);
    expect(props.c).toBe("j");
    expect(props.d).toBe("DD");
    set({ a: "h" });
    flushSync();
    expect(props.a).toBe("h");
    expect(props.b).toBe("ggg");
    expect(props.c).toBeUndefined();
    expect(props.d).toBe("DD");
    expect(res[0]).toBe("ji");
    expect(res[1]).toBe("h");
    expect(res.length).toBe(2);
  });

  test("null/undefined/false are ignored", () => {
    const props = merge({ a: 1 }, null, undefined, false);
    expect((props as any).a).toBe(1);
  });
});

describe("omit Props", () => {
  test("omit in two", () => {
    createRoot(() => {
      const out = Comp2({
        greeting: "Hi",
        get name() {
          return "dynamic";
        }
      });
      expect(out).toBe("Hi dynamic");
    });
  });
  test("omit in two with store", () => {
    createRoot(() => {
      const [state] = createStore({ greeting: "Yo", name: "Bob" });
      const out = Comp2(state);
      expect(out).toBe("Yo Bob");
    });
  });
  test("omit result is immutable", () => {
    const props = { first: 1, second: 2 };
    const otherProps = omit(props, "first");
    props.first = props.second = 3;
    expect(props.first).toBe(3);
    expect(otherProps.second).toBe(2);
  });
  test("omit clones the descriptor", () => {
    let signalValue = 1;
    const desc = {
      signal: {
        enumerable: true,
        get() {
          return signalValue;
        }
      },
      static: {
        configurable: true,
        enumerable: false,
        value: 2
      }
    };
    const props = Object.defineProperties({}, desc) as {
      signal: number;
      value1: number;
    };
    const otherProps = omit(props, "signal");

    expect(props.signal).toBe(1);
    signalValue++;
    expect(props.signal).toBe(2);

    const signalDesc = Object.getOwnPropertyDescriptor(props, "signal")!;
    expect(signalDesc.get === desc.signal.get).toBeTruthy();
    expect(signalDesc.set).toBeUndefined();
    expect(signalDesc.enumerable).toBeTruthy();
    expect(signalDesc.configurable).toBeFalsy();

    const staticDesc = Object.getOwnPropertyDescriptor(otherProps, "static")!;
    expect(staticDesc.value).toBe(2);
    expect(staticDesc.get).toBeUndefined();
    expect(staticDesc.set).toBeUndefined();
    expect(staticDesc.enumerable).toBeFalsy();
    expect(staticDesc.configurable).toBeTruthy();
  });
  test("omit with multiple keys", () => {
    const props: {
      id?: string;
      color?: string;
      margin?: number;
      padding?: number;
      variant?: string;
      description?: string;
    } = {
      id: "input",
      color: "red",
      margin: 3,
      variant: "outlined",
      description: "test"
    };

    const otherProps = omit(props, "color", "margin", "padding", "variant", "description");

    expect(otherProps.id).toBe("input");
    expect(Object.keys(otherProps).length).toBe(1);
  });
  test("omit returns same prop descriptors", () => {
    const props = {
      a: 1,
      b: 2,
      get c() {
        return 3;
      },
      d: undefined,
      x: 1,
      y: 2,
      get w() {
        return 3;
      },
      z: undefined
    };
    const otherProps = omit(props, "a", "b", "c", "d", "e" as "d");

    const otherDesc = Object.getOwnPropertyDescriptors(otherProps);
    expect(otherDesc.w).toMatchObject(otherDesc.w);
    expect(otherDesc.x).toMatchObject(otherDesc.x);
    expect(otherDesc.y).toMatchObject(otherDesc.y);
    expect(otherDesc.z).toMatchObject(otherDesc.z);
  });
  test("omit is safe", () => {
    const props = JSON.parse('{"__proto__": { "evil": true } }');
    const evilProps1 = omit(props);

    expect(evilProps1.__proto__?.evil).toBeTruthy();
    expect(({} as any).evil).toBeUndefined();

    const evilProps2 = omit(props, "__proto__");

    expect(evilProps2.__proto__?.evil).toBeFalsy();
    expect(({} as any).evil).toBeUndefined();
  });

  test("Merge omit", () => {
    let value: string | undefined = "green";
    const splittedProps = omit(
      { color: "blue", component() {} } as { color: string; component: Function; other?: string },
      "component"
    );
    const mergedProps = merge(splittedProps, {
      get color() {
        return value;
      },
      other: "value"
    });
    expect(mergedProps.color).toBe("green");
    value = "red";
    expect(mergedProps.color).toBe("red");
  });
});
