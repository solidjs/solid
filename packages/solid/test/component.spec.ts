import { describe, expect, it, test } from "vitest";
import {
  createRoot,
  createComponent,
  mergeProps,
  splitProps,
  createUniqueId,
  createSignal,
  createEffect,
  JSX
} from "../src/index.js";
import { createStore } from "../store/src/index.js";

type SimplePropTypes = {
  a?: string | null;
  b?: string | null;
  c?: string | null;
  d?: string | null;
};

const Comp = (props: { greeting: string; name: string }) => `${props.greeting} ${props.name}`;

const Comp2 = (props: { greeting: string; name: string; optional?: string }) => {
  const [p, q] = splitProps(props, ["greeting", "optional"]);
  expect((p as any).name).toBeUndefined();
  expect((q as any).greeting).toBeUndefined();
  return `${p.greeting} ${q.name}`;
};

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

describe("mergeProps", () => {
  test("falsey values", () => {
    let props: SimplePropTypes = {
      get a() {
        return "ji";
      },
      b: null,
      c: "j"
    };
    props = mergeProps(props, false, null, undefined);
    expect(props.a).toBe("ji");
    expect(props.b).toBe(null);
    expect(props.c).toBe("j");
  });
  it("skips undefined values", () => {
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
    const props = mergeProps(a, b, c, d);
    expect(props.value).toBe(1);
    bValue = 2;
    expect(props.value).toBe(2);
  });
  it("includes undefined property", () => {
    const value = { a: undefined };
    const getter = {
      get a() {
        return undefined;
      }
    };
    expect("a" in mergeProps(value)).toBeTruthy();
    expect("a" in mergeProps(getter)).toBeTruthy();
    expect("a" in mergeProps(value, getter)).toBeTruthy();
    expect("a" in mergeProps(getter, value)).toBeTruthy();
  });
  it("doesn't keep references for non-getters", () => {
    const a = { value1: 1 };
    const b = { value2: 2 };
    const props = mergeProps(a, b);
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
    const props = mergeProps(a, b);
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
    const props = mergeProps({}, a);
    expect((props as any).value1).toBe(2);
    expect(Object.getOwnPropertyDescriptor(props, "value1")?.enumerable).toBeTruthy();
    expect(Object.keys(props).join()).toBe("value1");
  });
  it("does not write the target", () => {
    const props = { value1: 1 };
    mergeProps(props, {
      value2: 2,
      get value3() {
        return 3;
      }
    });
    expect(Object.keys(props).join("")).toBe("value1");
  });
  it("always returns a new reference", () => {
    const props = {};
    const newProps = mergeProps(props);
    expect(props === newProps).toBeFalsy();
  });
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
    const props = mergeProps(source1, source2);
    expect(props.a === source1).toBeTruthy();
    expect(props.b === source2).toBeTruthy();
  });
  it("does not clone nested objects", () => {
    const b = { value: 1 };
    const props = mergeProps({ a: 1 }, { b });
    b.value = 2;
    expect(props.b.value).toBe(2);
  });
  it("ignores undefined values", () => {
    const props = mergeProps({ a: 1 }, { a: undefined });
    expect(props.a).toBe(1);
  });
  it("handles null values", () => {
    const props = mergeProps({ a: 1 }, { a: null });
    expect(props.a).toBeNull();
  });
  it("contains null values", () => {
    const props = mergeProps({
      a: null,
      get b() {
        return null;
      }
    });
    expect(props.a).toBeNull();
    expect(props.b).toBeNull();
  });
  it("contains undefined values", () => {
    const props = mergeProps({
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
    const props = mergeProps(undefined, null, { value: 1 }, null, undefined);
    expect(Object.keys(props).join()).toBe("value");
  });
  it("fails with non objects sources", () => {
    expect(() => mergeProps({ value: 1 }, true)).toThrowError();
    expect(() => mergeProps({ value: 1 }, 1)).toThrowError();
  });
  it("works with a array source", () => {
    const props = mergeProps({ value: 1 }, [2]);
    expect(Object.keys(props).join()).toBe("0,value,length");
    expect(props.value).toBe(1);
    expect(props.length).toBe(1);
    expect(props[0]).toBe(2);
  });
  it("is safe", () => {
    mergeProps({}, JSON.parse('{ "__proto__": { "evil": true } }'));
    expect(({} as any).evil).toBeUndefined();
    mergeProps({}, JSON.parse('{ "prototype": { "evil": true } }'));
    expect(({} as any).evil).toBeUndefined();
    mergeProps({ value: 1 }, JSON.parse('{ "__proto__": { "evil": true } }'));
    expect(({} as any).evil).toBeUndefined();
    mergeProps({ value: 1 }, JSON.parse('{ "prototype": { "evil": true } }'));
    expect(({} as any).evil).toBeUndefined();
  });
  it("sets already prototyped properties", () => {
    expect(mergeProps({ toString: 1 }).toString).toBe(1);
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
    props = mergeProps(defaults, props);
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
    const newProps = mergeProps({}, props);
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
    const clone = mergeProps(state);
    expect(clone.a).toBe("Hi");
    expect(clone.b).toBe("Jo");
    setState({ a: "Greetings", c: "John" });
    expect(clone.a).toBe("Greetings");
    expect(clone.b).toBe("Jo");
    expect(clone.c).toBe("John");
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
      props = mergeProps(defaults, s);
      createEffect(() => {
        res.push(props.a as string);
      });
    });
    expect(props.a).toBe("ji");
    expect(props.b).toBe(null);
    expect(props.c).toBe("j");
    expect(props.d).toBe("DD");
    set({ a: "h" });
    expect(props.a).toBe("h");
    expect(props.b).toBe("ggg");
    expect(props.c).toBeUndefined();
    expect(props.d).toBe("DD");
    expect(res[0]).toBe("ji");
    expect(res[1]).toBe("h");
    expect(res.length).toBe(2);
  });

  test("null/undefined/false are ignored", () => {
    const props = mergeProps({ a: 1 }, null, undefined, false);
    expect(props).toEqual({ a: 1 });
  });
});

describe("SplitProps Props", () => {
  test("SplitProps in two", () => {
    createRoot(() => {
      const out = createComponent(Comp2, {
        greeting: "Hi",
        get name() {
          return "dynamic";
        }
      });
      expect(out).toBe("Hi dynamic");
    });
  });
  test("SplitProps in two with store", () => {
    createRoot(() => {
      const [state] = createStore({ greeting: "Yo", name: "Bob" });
      const out = createComponent(Comp2, state);
      expect(out).toBe("Yo Bob");
    });
  });
  test("SplitProps result is inmutable", () => {
    const inProps = { first: 1, second: 2 };
    const [props, otherProps] = splitProps(inProps, ["first"]);
    inProps.first = inProps.second = 3;
    expect(props.first).toBe(1);
    expect(otherProps.second).toBe(2);
  });
  test("SplitProps clones the descriptor", () => {
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
    const inProps = Object.defineProperties({}, desc) as { signal: number; value1: number };
    const [props, otherProps] = splitProps(inProps, ["signal"]);

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
  test("SplitProps with multiple keys", () => {
    const inProps: {
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

    const [styleProps, inputProps, otherProps] = splitProps(
      inProps,
      ["color", "margin", "padding"],
      ["variant", "description"]
    );

    expect(styleProps.color).toBe("red");
    expect(styleProps.margin).toBe(3);
    expect(styleProps.padding).toBeUndefined();
    expect(Object.keys(styleProps).length).toBe(2);

    expect(inputProps.description).toBe("test");
    expect(inputProps.variant).toBe("outlined");
    expect(Object.keys(inputProps).length).toBe(2);

    expect(otherProps.id).toBe("input");
    expect(Object.keys(otherProps).length).toBe(1);
  });
  test("SplitProps returns same prop descriptors", () => {
    const inProps = {
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
    const inDescriptor = Object.getOwnPropertyDescriptors(inProps);
    const [props, otherProps] = splitProps(inProps, ["a", "b", "c", "d", "e" as "d"]);

    const propsDesc = Object.getOwnPropertyDescriptors(props);
    expect(propsDesc.a).toMatchObject(inDescriptor.a);
    expect(propsDesc.b).toMatchObject(inDescriptor.b);
    expect(propsDesc.c).toMatchObject(inDescriptor.c);
    expect(propsDesc.d).toMatchObject(inDescriptor.d);
    expect(propsDesc.e).toBeUndefined();

    const otherDesc = Object.getOwnPropertyDescriptors(otherProps);
    expect(otherDesc.w).toMatchObject(otherDesc.w);
    expect(otherDesc.x).toMatchObject(otherDesc.x);
    expect(otherDesc.y).toMatchObject(otherDesc.y);
    expect(otherDesc.z).toMatchObject(otherDesc.z);
  });
  test("SplitProps is safe", () => {
    const inProps = JSON.parse('{"__proto__": { "evil": true } }');
    const [, evilProps1] = splitProps(inProps, []);

    expect(evilProps1.__proto__?.evil).toBeTruthy();
    expect(({} as any).evil).toBeUndefined();

    const [evilProps2] = splitProps(inProps, ["__proto__"]);

    expect(evilProps2.__proto__?.evil).toBeTruthy();
    expect(({} as any).evil).toBeUndefined();
  });

  test("Merge SplitProps", () => {
    let value: string | undefined = undefined;
    const [splittedProps] = splitProps({ color: "blue" } as { color: string; other?: string }, [
      "color",
      "other"
    ]);
    const mergedProps = mergeProps(splittedProps, {
      get color() {
        return value;
      },
      other: "value"
    });
    expect(mergedProps.color).toBe("blue");
    value = "red";
    expect(mergedProps.color).toBe("red");
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
