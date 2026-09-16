import {
  $PROXY,
  createEffect,
  createRoot,
  createSignal,
  createStore,
  deep,
  flush,
  getOwner,
  $TARGET,
  merge,
  mergeSources,
  hasStaticKeys,
  isStatic,
  omit,
  OmitView,
  MergeView,
  viewOf,
  resolvedTable,
  sourceKeys,
  sourceHas,
  sourceGet,
  SOURCE_PLAIN,
  SOURCE_OMIT,
  SOURCE_PROXY,
  SOURCE_MEMO,
  reconcile,
  snapshot,
  type Store
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

() => {
  type A = { name: string };
  type B = { id: number };
  type QueryResult = Store<A | B>;

  const [state] = createStore<A | B>({ name: "solid" });
  const result = deep(state as QueryResult);

  const sameType: QueryResult = result;
  void sameType;
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
  it("is a live view: data properties read through to the sources", () => {
    // Never a copy (#3448): a plain data property on a source is read at
    // access time, the same as a getter, so a source mutated later is seen.
    const a = { value1: 1 };
    const b = {
      get value2() {
        return undefined;
      }
    };
    const props = merge(a, b);
    a.value1 = 3;
    expect(props.value1).toBe(3);
    expect(Object.keys(props).join()).toBe("value1,value2");
  });
  it("mirrors the source's enumerability", () => {
    const a = Object.defineProperties(
      {},
      {
        value1: {
          enumerable: false,
          value: 2
        }
      }
    );
    const props = merge(a, { value2: 1 });
    expect((props as any).value1).toBe(2);
    expect("value1" in props).toBe(true);
    expect(Object.getOwnPropertyDescriptor(props, "value1")?.enumerable).toBe(false);
    expect(Object.keys(props).join()).toBe("value2");
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
  it("returns same reference when only one source is non-falsy", () => {
    const props = { a: 1, b: 2 };
    expect(merge(null, props, undefined) === props).toBeTruthy();
    const view = omit({ a: 1, b: 2 }, "a");
    expect(merge(false, view) === view).toBeTruthy();
  });
  it("returns a view when there are several sources, even if the last covers every key", () => {
    // No key enumeration at construction: a view is O(1) to make, and the
    // shortcut would have cost a key walk on every merge to save nothing.
    const props = { a: 1, b: 2 };
    const newProps = merge({ a: 2 }, { b: 2 }, props);
    expect(props === newProps).toBeFalsy();
    expect(newProps.a).toBe(1);
    expect(mergeSources(newProps)).toEqual([{ a: 2 }, { b: 2 }, props]);
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
    const props = merge(source1, source2);
    expect(props.a === source1).toBeTruthy();
    expect(props.b === source2).toBeTruthy();
  });
  it("flattens nested merge sources in order", () => {
    const a = { a: 1 };
    const b = { b: 2 };
    const target = { a: 3, b: 4 };
    const props = merge(merge(a, b), target);
    expect(mergeSources(props)).toEqual([a, b, target]);
    expect(props.a).toBe(3);
    expect(merge(merge({ value: 1 }, { value: 2 }), { value: 3 }).value).toBe(3);
    expect(merge({ value: 1 }, merge({ value: 2 }, { value: 3 })).value).toBe(3);
    const inner = merge({ value: 2 }, { value: 3 });
    expect(mergeSources(merge({ value: 1 }, inner))).toEqual([
      { value: 1 },
      { value: 2 },
      { value: 3 }
    ]);
  });
  it("does not clone nested objects", () => {
    const b = { value: 1 };
    const props = merge({ a: 1 }, { b });
    b.value = 2;
    expect(props.b.value).toBe(2);
  });
  // #3384: the plain-object result is a real object callers may copy or
  // mutate. A later merge must read what is on the object, not tunnel back
  // to the sources it was built from.
  it("re-merging a descriptor copy of a merged object reads the copy (#3384)", () => {
    const props = merge({ href: "/x", title: "t" }, { $active: true, children: "hi" });
    const out: Record<PropertyKey, unknown> = {};
    for (const key of Reflect.ownKeys(props)) {
      if (key === "$active") continue;
      Object.defineProperty(out, key, Reflect.getOwnPropertyDescriptor(props, key)!);
    }
    Object.defineProperty(out, "class", {
      get: () => "yak-abc",
      enumerable: true,
      configurable: true
    });
    const final = merge(out, { rel: "noopener" }) as Record<string, unknown>;
    expect(final.class).toBe("yak-abc");
    expect(final.$active).toBeUndefined();
    expect(final.href).toBe("/x");
    expect(final.children).toBe("hi");
    expect(Object.keys(final).sort()).toEqual(["children", "class", "href", "rel", "title"]);
  });
  it("re-merging a spread copy of a merged object reads the copy (#3384)", () => {
    const props = merge({ a: 1, b: 2 }, { c: 3 });
    const copy = { ...props, b: 20, d: 4 } as Record<string, unknown>;
    delete copy.a;
    const final = merge(copy, { e: 5 }) as Record<string, unknown>;
    expect(final.a).toBeUndefined();
    expect(final.b).toBe(20);
    expect(final.d).toBe(4);
    expect(Object.getOwnPropertySymbols(final)).toEqual([]);
  });
  it("writes to a merged object are no-ops; a copy is a plain object (#3384)", () => {
    // The result is a view over its sources, never a copy: assigning onto it
    // changes nothing (a consumer that needs its own object copies it first,
    // and the copy carries no $SOURCES). @solidjs/html builds its own objects
    // and merges once for exactly this reason.
    const props = merge({ type: "button", label: "a" }, { disabled: false }) as Record<
      string,
      unknown
    >;
    props.label = "b";
    props.extra = 1;
    Object.defineProperty(props, "children", { get: () => "kids", configurable: true });
    expect(props.label).toBe("a");
    expect("extra" in props).toBe(false);
    expect(props.children).toBeUndefined();
    const copy = { ...props, label: "b" };
    expect(Object.getOwnPropertySymbols(copy)).toEqual([]);
    expect(mergeSources(copy)).toBeUndefined();
    const final = merge({ type: "submit", size: "m" }, copy) as Record<string, unknown>;
    expect(final.type).toBe("button");
    expect(final.label).toBe("b");
    expect(final.size).toBe("m");
  });
  it("flattens merge proxies (writes are no-ops, so the sources are the truth)", () => {
    const [store] = createStore({ a: 1 });
    const b = { b: 2 };
    const c = { c: 3 };
    const inner = merge(b, store);
    const outer = merge(inner, c);
    expect(mergeSources(outer)).toEqual([b, store, c]);
    expect(outer.a).toBe(1);
    expect(outer.b).toBe(2);
    expect(outer.c).toBe(3);
    expect(Object.keys(outer).sort()).toEqual(["a", "b", "c"]);
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
    // `length` is not enumerable on the array and the view mirrors that
    expect(Object.keys(props).join()).toBe("value,0");
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
    // Writes batch — the clone (a merge over the source) reflects the previous values until flush.
    expect(clone.a).toBe("Hi");
    expect(clone.b).toBe("Jo");
    expect(clone.c).toBeUndefined();
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
    flush();
    expect(props.a).toBe("ji");
    expect(props.b).toBe(null);
    expect(props.c).toBe("j");
    expect(props.d).toBe("DD");
    set({ a: "h" });
    flush();
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
  test("omit with store hides keys from proxy traps", () => {
    createRoot(() => {
      const [state] = createStore({ id: "input", color: "red", disabled: true });
      const otherProps = omit(state, "color", "disabled");

      expect(otherProps.id).toBe("input");
      expect((otherProps as any).color).toBeUndefined();
      expect("id" in otherProps).toBeTruthy();
      expect("color" in otherProps).toBeFalsy();
      expect(Object.keys(otherProps)).toEqual(["id"]);
    });
  });
  test("re-merging an omit() of a merge proxy keeps omitted keys hidden (#3014)", () => {
    createRoot(() => {
      const [value] = createSignal("a@b.c");
      // Callee props as the compiler produces them for a call site mixing
      // static JSX props with a dynamic spread: a merge proxy.
      const props = merge(
        { label: "Email", name: "email", placeholder: "you@example.com" },
        () => ({
          value: value(),
          onChange: (_v: string) => {}
        })
      );
      const rest = omit(props, "name", "label", "value", "onChange");
      expect(Object.keys(rest)).toEqual(["placeholder"]);

      // The element-spread path re-merges statics with the rest object —
      // merge() must not flatten through omit's filter via $SOURCES.
      const spread = merge({ name: "email", value: "a@b.c" }, rest);
      expect(Object.keys(spread).sort()).toEqual(["name", "placeholder", "value"]);
      expect((spread as any).label).toBeUndefined();
      expect((spread as any).onChange).toBeUndefined();
      expect("label" in spread).toBe(false);
      expect("onChange" in spread).toBe(false);
      // non-omitted keys still flow reactively through both layers
      expect((spread as any).placeholder).toBe("you@example.com");
    });
  });
  test("omit result is a live view, not a copy", () => {
    // Nothing is read or materialized at omit() time: the result reads its
    // source when a key is used, the same for a plain object as for a store
    // or merge proxy, so a later change to the source shows through.
    let reads = 0;
    const props = {
      first: 1,
      second: 2,
      get third() {
        reads++;
        return 3;
      }
    };
    const otherProps = omit(props, "first");
    expect(reads).toBe(0);
    props.first = props.second = 3;
    expect(otherProps.second).toBe(3);
    expect(otherProps.third).toBe(3);
    expect(reads).toBe(1);
  });
  test("omit result rejects writes", () => {
    const props = { first: 1, second: 2 };
    const otherProps = omit(props, "first") as any;
    otherProps.second = 9;
    delete otherProps.second;
    expect(otherProps.second).toBe(2);
    expect(props.second).toBe(2);
  });
  test("omit with a predicate hides keys by rule", () => {
    const props = {
      $props: 1,
      $theme: 2,
      id: "x",
      get label() {
        return "L";
      }
    };
    const rest = omit(props, k => typeof k === "string" && k[0] === "$");
    expect(Object.keys(rest)).toEqual(["id", "label"]);
    expect("$props" in rest).toBe(false);
    expect((rest as any).$props).toBeUndefined();
    expect(rest.label).toBe("L");
    expect({ ...rest }).toEqual({ id: "x", label: "L" });
  });
  test("omit of an omit flattens to one view over the original source", () => {
    let reads = 0;
    const props = {
      a: 1,
      b: 2,
      get c() {
        reads++;
        return 3;
      },
      d: 4
    };
    const inner = omit(props, "a");
    const outer = omit(inner, "b");
    expect(Object.keys(outer)).toEqual(["c", "d"]);
    expect("a" in outer).toBe(false);
    expect("b" in outer).toBe(false);
    expect(outer.c).toBe(3);
    expect(reads).toBe(1);
    // and with a predicate on either layer
    const outer2 = omit(inner, k => k === "d");
    expect(Object.keys(outer2)).toEqual(["b", "c"]);
  });
  test("merge over an omit of a plain object stays lazy and filtered", () => {
    let reads = 0;
    const props = {
      hidden: "h",
      get shown() {
        reads++;
        return "s";
      },
      both: "from-props"
    };
    const merged = merge(omit(props, "hidden"), { both: "from-later", extra: 1 });
    expect(reads).toBe(0);
    expect(Object.keys(merged).sort()).toEqual(["both", "extra", "shown"]);
    expect("hidden" in merged).toBe(false);
    expect((merged as any).hidden).toBeUndefined();
    expect(merged.both).toBe("from-later");
    expect(merged.shown).toBe("s");
    expect(reads).toBe(1);
  });
  test("a defaults + omit + spread chain flattens to leaf objects with filters", () => {
    // A component chain: each layer merges defaults, hides its own keys and
    // spreads the rest into the next. The outermost merge must resolve to
    // the leaf objects — no merge or omit PROXY left among its sources — and
    // every hidden key of every layer must stay hidden.
    let reads = 0;
    const props = {
      a: "a",
      b: "b",
      get c() {
        reads++;
        return "c";
      },
      d: "d",
      e: "e"
    };
    const layer1 = merge({ a: "def-a", x: 1 }, props); // defaults
    const rest1 = omit(layer1, "a"); // hides a
    const layer2 = merge({ y: 2 }, rest1, () => ({ b: "fn-b" })); // defaults, function source
    const rest2 = omit(layer2, "b", "y"); // hides b, y
    const out = merge(rest2, { z: 3 });

    const leaves = mergeSources(out)!;
    for (const leaf of leaves) {
      expect(typeof leaf === "function" || leaf instanceof OmitView || !($PROXY in leaf)).toBe(
        true
      );
    }
    expect(Object.keys(out).sort()).toEqual(["c", "d", "e", "x", "z"]);
    expect("a" in out).toBe(false);
    expect("b" in out).toBe(false);
    expect("y" in out).toBe(false);
    expect((out as any).a).toBeUndefined();
    expect((out as any).b).toBeUndefined();
    expect(out.x).toBe(1);
    expect(out.z).toBe(3);
    expect(reads).toBe(0);
    expect(out.c).toBe("c");
    expect(reads).toBe(1);
    // the intermediate views themselves still answer correctly
    expect(Object.keys(rest2).sort()).toEqual(["c", "d", "e", "x"]);
    expect((rest1 as any).a).toBeUndefined();
    expect(rest1.b).toBe("b");
  });
  test("omit keeps symbol-keyed props unless hidden", () => {
    const sym = Symbol("s");
    const props = { a: 1, [sym]: 2 };
    expect(Reflect.ownKeys(omit(props, "a"))).toEqual([sym]);
    expect(Reflect.ownKeys(omit(props, sym as any))).toEqual(["a"]);
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

// The view proxies must tell consumers the truth about what is behind a key,
// through any depth of layers: `getOwnPropertyDescriptor` reports a DATA
// descriptor only when the key is a data property of a plain-object leaf
// (the compiler's encoding of a static prop), and `hasStaticKeys` says
// whether the key set itself is fixed. That is what lets spread() skip a
// reactive node for static children at the bottom of a component chain.
describe("view descriptors", () => {
  test("merge reports the owning leaf's kind: data stays data, getter stays getter", () => {
    const [sig] = createSignal("x");
    const props = merge(
      { a: 1, shadowed: "lower" },
      {
        get b() {
          return sig();
        },
        shadowed: "upper"
      }
    );
    const a = Object.getOwnPropertyDescriptor(props, "a")!;
    expect(a.get).toBeUndefined();
    expect(a.value).toBe(1);
    expect(a.configurable).toBe(true);
    const b = Object.getOwnPropertyDescriptor(props, "b")!;
    expect(typeof b.get).toBe("function");
    expect(b.get!()).toBe("x");
    expect(Object.getOwnPropertyDescriptor(props, "shadowed")!.value).toBe("upper");
    expect(Object.getOwnPropertyDescriptor(props, "missing")).toBeUndefined();
  });
  test("a store leaf or a memo source is always an accessor, whatever the store reports", () => {
    createRoot(() => {
      const [store] = createStore({ a: 1 });
      const overStore = merge({ b: 2 }, store);
      expect(typeof Object.getOwnPropertyDescriptor(overStore, "a")!.get).toBe("function");
      expect(Object.getOwnPropertyDescriptor(overStore, "b")!.value).toBe(2);
      const overMemo = merge({ b: 2 }, () => ({ a: 1 }));
      expect(typeof Object.getOwnPropertyDescriptor(overMemo, "a")!.get).toBe("function");
      const omitOverStore = omit(store, "z");
      expect(typeof Object.getOwnPropertyDescriptor(omitOverStore, "a")!.get).toBe("function");
    });
  });
  test("omit forwards its source's kind and hides its keys", () => {
    const view = omit(
      {
        a: 1,
        get b() {
          return 2;
        },
        c: 3
      },
      "c"
    );
    expect(Object.getOwnPropertyDescriptor(view, "a")!.value).toBe(1);
    expect(typeof Object.getOwnPropertyDescriptor(view, "b")!.get).toBe("function");
    expect(Object.getOwnPropertyDescriptor(view, "c")).toBeUndefined();
  });
  test("kind survives omit → merge → omit → merge, and the layers collapse to leaf views", () => {
    const user = {
      class: "btn",
      get label() {
        return "l";
      },
      as: "a",
      type: "reset"
    };
    const l1 = merge({ type: "button" }, user);
    const l2 = omit(l1, "type");
    const l3 = merge({ as: "button", role: "button" }, l2);
    const l4 = omit(l3, "as");
    const l5 = merge(l4, { extra: 1 });
    // every layer is one deep: leaf views over the original objects
    const leaves = mergeSources(l5)!;
    expect(leaves.length).toBe(4);
    for (const leaf of leaves.slice(0, 3)) expect(leaf).toBeInstanceOf(OmitView);
    // l3's statics, l1's defaults, the user's props — in merge order
    expect((leaves[0] as OmitView).hidden).toEqual(["as"]);
    expect((leaves[2] as OmitView).source).toBe(user);
    // both filters, chained rather than copied: the inner omit's list and the
    // outer's, in that order
    expect((leaves[2] as OmitView).hidden).toEqual({ inner: ["type"], outer: ["as"] });
    // and the truth reaches the top
    expect(Object.getOwnPropertyDescriptor(l5, "class")!.value).toBe("btn");
    expect(typeof Object.getOwnPropertyDescriptor(l5, "label")!.get).toBe("function");
    expect(Object.getOwnPropertyDescriptor(l5, "type")).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(l5, "as")).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(l5, "role")!.value).toBe("button");
    expect(Object.keys(l5).sort()).toEqual(["class", "extra", "label", "role"]);
  });
  test("folded filters chain: lists, predicates and empty omits over each other", () => {
    const user = { a: 1, b: 2, c: 3, d: 4, e: 5 };
    // omit of omit of predicate-omit of a no-key omit — every combination
    const o1 = omit(user); // nothing hidden: adds no link
    const o2 = omit(o1, (key: PropertyKey) => key === "a");
    const o3 = omit(o2, "b");
    const o4 = omit(o3); // still nothing added
    const o5 = omit(o4, "c", "zz");
    const view = viewOf(o5) as OmitView;
    expect(view.source).toBe(user);
    expect(view.hidden).toEqual({
      inner: { inner: expect.any(Function), outer: ["b"] },
      outer: ["c", "zz"]
    });
    expect(Object.keys(o5)).toEqual(["d", "e"]);
    expect("a" in o5).toBe(false);
    expect("b" in o5).toBe(false);
    expect("c" in o5).toBe(false);
    expect("d" in o5).toBe(true);
    expect(o5.a).toBeUndefined();
    expect(o5.d).toBe(4);
    expect(Object.getOwnPropertyDescriptor(o5, "b")).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(o5, "e")!.value).toBe(5);
    // through a merge, the chained filter travels with the leaf
    const m = merge({ x: 0 }, o5);
    expect(Object.keys(m)).toEqual(["x", "d", "e"]);
    const o6 = omit(m, "d");
    expect(Object.keys(o6)).toEqual(["x", "e"]);
    expect({ ...o6 }).toEqual({ x: 0, e: 5 });
  });
  // A store-shaped proxy that logs every trap it is asked. `$PROXY in`,
  // `$TARGET` and `$PROXY` are a store's fast paths; anything else — an
  // unknown symbol taking its generic read path, `getPrototypeOf` from an
  // `instanceof`, a descriptor per key — is a cost per read that the views
  // must not add over a direct read of the store.
  function storeShaped(data: Record<string, unknown>) {
    const log: string[] = [];
    const target = {};
    const proxy: any = new Proxy(target, {
      get(_, key, receiver) {
        if (key === $PROXY) return receiver;
        if (key === $TARGET) return target;
        log.push(`get ${String(key)}`);
        return data[key as string];
      },
      has(_, key) {
        if (key === $PROXY || key === $TARGET) return true;
        log.push(`has ${String(key)}`);
        return key in data;
      },
      ownKeys() {
        log.push("ownKeys");
        return Reflect.ownKeys(data);
      },
      getOwnPropertyDescriptor(_, key) {
        log.push(`descriptor ${String(key)}`);
        const desc = Reflect.getOwnPropertyDescriptor(data, key);
        return desc && { ...desc, configurable: true };
      },
      getPrototypeOf() {
        log.push("getPrototypeOf");
        return Object.prototype;
      }
    });
    return { proxy, log };
  }
  test("a read through a merge or omit asks a store exactly what a direct read would", () => {
    const { proxy: store, log } = storeShaped({ a: 1, b: 2 });
    const merged: any = merge({ a: 0, z: 9 }, store);
    expect(log).toEqual([]);
    expect(merged.a).toBe(1);
    expect(log).toEqual(["has a", "get a"]);
    log.length = 0;
    expect(merged.z).toBe(9);
    expect(log).toEqual(["has z"]);
    log.length = 0;
    expect("b" in merged).toBe(true);
    expect(log).toEqual(["has b"]);
    log.length = 0;

    const rest: any = omit(store, "a");
    expect(log).toEqual([]);
    expect(rest.b).toBe(2);
    expect(rest.a).toBeUndefined();
    expect(log).toEqual(["get b"]);
    log.length = 0;

    // Enumeration: one ownKeys, then per key one existence check for the
    // descriptor — never the store's own descriptor trap.
    expect(Object.keys(rest)).toEqual(["b"]);
    expect(log).toEqual(["ownKeys", "has b"]);
    log.length = 0;
    // A merge with a store leaf has no resolved table: the user-facing key
    // set is the enumerable keys of each source (a descriptor per store key,
    // #2769), then each key is a shadowing walk (`has` on the store) that
    // the descriptor reuses.
    expect(Object.keys(merged)).toEqual(["z", "a", "b"]);
    expect(log).toEqual(["ownKeys", "descriptor a", "descriptor b", "has z", "has a", "has b"]);
    log.length = 0;

    // The consumers' entry helpers over the store's kind: no probe at all.
    expect(sourceKeys(store, SOURCE_PROXY)).toEqual(["a", "b"]);
    expect(sourceHas(store, SOURCE_PROXY, "a")).toBe(true);
    expect(sourceGet(store, SOURCE_PROXY, "a")).toBe(1);
    expect(log).toEqual(["ownKeys", "has a", "get a"]);
    log.length = 0;
    expect(hasStaticKeys(store)).toBe(false);
    expect(viewOf(store)).toBeUndefined();
    expect(resolvedTable(store)).toBeUndefined();
    expect(log).toEqual([]);
  });
  test("merge and omit record what each source is, once", () => {
    const store = createStore({ s: 1 })[0];
    const plain = { p: 1 };
    const rest = omit({ o: 1, hide: 1 }, "hide");
    const memo = () => ({ m: 1 });
    const merged = merge(plain, store, rest, memo);
    const view = viewOf(merged) as MergeView;
    expect(view).toBeInstanceOf(MergeView);
    expect(view.kinds).toEqual([SOURCE_PLAIN, SOURCE_PROXY, SOURCE_OMIT, SOURCE_MEMO]);
    expect(view.sources[0]).toBe(plain);
    expect(view.sources[1]).toBe(store);
    expect(view.sources[2]).toBeInstanceOf(OmitView);
    expect(typeof view.sources[3]).toBe("function");
    // A merge among the sources flattens with its kinds.
    const outer = viewOf(merge({ x: 1 }, merged)) as MergeView;
    expect(outer.kinds).toEqual([
      SOURCE_PLAIN,
      SOURCE_PLAIN,
      SOURCE_PROXY,
      SOURCE_OMIT,
      SOURCE_MEMO
    ]);
    // An omit records its source's kind, and over a merge one entry per leaf.
    expect((viewOf(omit(store, "s")) as OmitView).kind).toBe(SOURCE_PROXY);
    expect((viewOf(omit(plain, "p")) as OmitView).kind).toBe(SOURCE_PLAIN);
    const overProxy: any = omit(merged, "p");
    const over = viewOf(overProxy) as OmitView;
    expect(over.kind).toBe(SOURCE_PROXY);
    expect(over.entries!.map(e => e.kind)).toEqual([
      SOURCE_PLAIN,
      SOURCE_PROXY,
      SOURCE_PLAIN,
      SOURCE_MEMO
    ]);
    expect(overProxy.p).toBeUndefined();
    expect(overProxy.s).toBe(1);
    expect(overProxy.o).toBe(1);
    expect(overProxy.hide).toBeUndefined();
    expect(overProxy.m).toBe(1);
  });
  test("the resolved table is built by an enumeration or paid for by reads, not on first read", () => {
    // A component chain: defaults → omit → call-site statics → omit, plain
    // leaves only, so a table is possible. Reads and existence checks and
    // descriptor lookups answer by a source walk while the view is young.
    const user = {
      as: "a",
      class: "btn",
      get title() {
        return "t";
      }
    };
    const merged: any = merge({ type: "button", as: "button" }, omit(user, "class"));
    const rest: any = omit(merged, "type");
    const mergedView = viewOf(merged) as MergeView;
    const restView = viewOf(rest) as OmitView;
    const expectSame = () => {
      expect(merged.as).toBe("a");
      expect(merged.type).toBe("button");
      expect(merged.class).toBeUndefined();
      expect(merged.title).toBe("t");
      expect("class" in merged).toBe(false);
      expect(Reflect.getOwnPropertyDescriptor(merged, "as")!.value).toBe("a");
      expect(rest.type).toBeUndefined();
      expect(rest.as).toBe("a");
      expect("type" in rest).toBe(false);
      expect(Reflect.getOwnPropertyDescriptor(rest, "title")!.get).toBeTypeOf("function");
    };
    expectSame(); // 8 trap reads on the merge (two of them through `rest`), 4 on the omit
    expect(mergedView.table).toBe(8); // the slot counts the reads until it is decided
    expect(restView.table).toBe(4);
    // …and once the reads have paid for a table (16), it is built and every
    // trap answers from it with the same results.
    expectSame();
    expect(mergedView.table).toBeInstanceOf(Map);
    expect(restView.table).toBe(8);
    expectSame();
    expectSame();
    expect(restView.table).toBeInstanceOf(Map);
    expectSame();
    // Enumeration builds it outright, even on a fresh view.
    const fresh: any = merge({ a: 1 }, { b: 2 });
    expect((viewOf(fresh) as MergeView).table).toBe(0);
    expect(Object.keys(fresh)).toEqual(["a", "b"]);
    expect((viewOf(fresh) as MergeView).table).toBeInstanceOf(Map);
    // An omit over one object never builds one: its read is direct.
    const plainRest: any = omit(user, "class");
    for (let i = 0; i < 40; i++) expect(plainRest.as).toBe("a");
    expect((viewOf(plainRest) as OmitView).table).toBe(0);
    // A view with a store leaf can't have one; reads keep walking after the
    // count runs out, and the answer is the same.
    const [store] = createStore({ s: 1 });
    const overStore: any = merge({ d: 0 }, store);
    for (let i = 0; i < 40; i++) expect(overStore.s).toBe(1);
    expect((viewOf(overStore) as MergeView).table).toBeNull();
  });
  test("hasStaticKeys: plain objects and views over them; not stores, memos, or views over them", () => {
    createRoot(() => {
      const [store] = createStore({ a: 1 });
      const plain = { a: 1 };
      expect(hasStaticKeys(plain)).toBe(true);
      expect(hasStaticKeys(merge(plain, { b: 2 }))).toBe(true);
      expect(hasStaticKeys(omit(plain, "a"))).toBe(true);
      expect(hasStaticKeys(omit(merge(plain, { b: 2 }), "a"))).toBe(true);
      expect(hasStaticKeys(merge(omit(merge(plain, { b: 2 }), "a"), { c: 3 }))).toBe(true);
      expect(hasStaticKeys(store)).toBe(false);
      expect(hasStaticKeys(merge(plain, store))).toBe(false);
      expect(hasStaticKeys(omit(store, "a"))).toBe(false);
      expect(hasStaticKeys(omit(merge(plain, store), "a"))).toBe(false);
      expect(hasStaticKeys(merge(plain, () => ({ b: 2 })))).toBe(false);
    });
  });
  // #3387: the per-key classification a polymorphic component reads to decide
  // whether `dynamic(() => props.as)` needs a computation at all. A data
  // property is what the compiler emits for a literal at the call site; a
  // getter is what it emits for an expression.
  describe("isStatic", () => {
    test("plain objects: data properties and absent keys are static, accessors are not", () => {
      const [sig] = createSignal("a");
      const props = {
        as: "button",
        get dyn() {
          return sig();
        }
      };
      expect(isStatic(props, "as")).toBe(true);
      expect(isStatic(props, "dyn")).toBe(false);
      // Absent from a plain object: it can never appear (no trap can add it).
      expect(isStatic(props, "missing")).toBe(true);
      // A setter-only accessor is not a fixed value either.
      const setterOnly = Object.defineProperty({}, "x", { set() {}, configurable: true });
      expect(isStatic(setterOnly, "x")).toBe(false);
    });
    test("through merge() and omit() views, the leaf that owns the key decides", () => {
      const [sig, setSig] = createSignal("a");
      const literal = { as: "button", label: "x" };
      const expr = {
        get as() {
          return sig();
        }
      };
      // The compiler's call-site shape: defaults merged under the caller's props.
      expect(isStatic(merge({ as: "div" }, literal), "as")).toBe(true);
      expect(isStatic(merge({ as: "div" }, expr), "as")).toBe(false);
      // Later sources shadow: a static override over a getter is static, and
      // vice versa — the descriptor is the WINNING leaf's.
      expect(isStatic(merge(expr, literal), "as")).toBe(true);
      expect(isStatic(merge(literal, expr), "as")).toBe(false);
      // omit() over either keeps the classification of what remains …
      expect(isStatic(omit(literal, "label"), "as")).toBe(true);
      expect(isStatic(omit(expr, "label"), "as")).toBe(false);
      // … and an omitted key is absent from a fixed key set: static.
      expect(isStatic(omit(literal, "as"), "as")).toBe(true);
      // Deep Kobalte-shaped chain: omit(merge(omit(merge(...)))).
      const chain = omit(
        merge({ as: "div" }, omit(merge(literal, { extra: 1 }), "extra")),
        "label"
      );
      expect(isStatic(chain, "as")).toBe(true);
      const chainDyn = omit(
        merge({ as: "div" }, omit(merge(expr, { extra: 1 }), "extra")),
        "label"
      );
      expect(isStatic(chainDyn, "as")).toBe(false);
      // The check reads no value: nothing was tracked, and the answer for a
      // getter does not depend on what it currently returns.
      setSig("b");
      flush();
      expect(isStatic(chainDyn, "as")).toBe(false);
    });
    test("memo sources, stores, and anything reaching them are not static", () => {
      const [store] = createStore({ as: "button" });
      const plain = { label: "x" };
      // A store answers `as` with a value, but the key can change and even
      // appear/disappear: never static, whether direct or through a view.
      expect(isStatic(store, "as")).toBe(false);
      expect(isStatic(store, "missing")).toBe(false);
      expect(isStatic(merge(plain, store), "as")).toBe(false);
      expect(isStatic(omit(store, "label"), "as")).toBe(false);
      // A key the store does NOT own, but the view's key set is not fixed:
      // the store could grow it later.
      expect(isStatic(merge(plain, store), "missing")).toBe(false);
      // A plain literal shadowing the store IS static: the store can't win.
      expect(isStatic(merge(store, { as: "a" }), "as")).toBe(true);
      // A memo-backed source resolves per read.
      expect(
        isStatic(
          merge(plain, () => ({ as: "a" })),
          "as"
        )
      ).toBe(false);
      expect(
        isStatic(
          merge(plain, () => ({ as: "a" })),
          "label"
        )
      ).toBe(true);
      expect(
        isStatic(
          merge(plain, () => ({ as: "a" })),
          "missing"
        )
      ).toBe(false);
    });
    test("a foreign proxy is opaque", () => {
      const foreign = new Proxy({ as: "a" }, {});
      expect($PROXY in foreign).toBe(false);
      // Not $PROXY-marked: treated as a plain object, its own descriptor rules.
      expect(isStatic(foreign, "as")).toBe(true);
      // $PROXY-marked but neither a store nor one of our views: unknown, so not static.
      const marked = new Proxy(
        { as: "a" },
        {
          has: (t, k) => k === $PROXY || k in t,
          get: (t, k) => (k === $PROXY ? marked : (t as any)[k])
        }
      );
      expect(isStatic(marked, "as")).toBe(false);
    });
  });
  test("a spread copy of a view is a plain snapshot with the right kinds", () => {
    let n = 0;
    const view = merge(
      { a: 1 },
      omit(
        {
          get b() {
            return ++n;
          },
          c: 3
        },
        "c"
      )
    );
    const copy = { ...view };
    expect(copy).toEqual({ a: 1, b: 1 });
    expect(Object.getOwnPropertyDescriptor(copy, "b")!.get).toBeUndefined();
    // a descriptor copy keeps the getter live
    const desc: Record<string, any> = {};
    for (const key of Reflect.ownKeys(view))
      Object.defineProperty(desc, key, Object.getOwnPropertyDescriptor(view, key)!);
    expect(desc.b).toBe(2);
    expect(desc.b).toBe(3);
  });
});

// The shape headless-UI libraries (Kobalte) compose per element: a compiled
// props object → merge(defaults) → omit(consumed) → merge(call-site statics)
// … → omit("as") at the polymorphic renderer. These pin what the chain must
// mean regardless of whether the layers are eager copies or lazy views.
describe("props chain (component-library shape)", () => {
  function compiledProps(label: () => string, open: () => boolean) {
    return {
      as: "a",
      class: "btn",
      href: "#row",
      get "aria-label"() {
        return label();
      },
      get disabled() {
        return open();
      }
    };
  }

  function buttonRoot(props: Record<string, any>) {
    // Button.Root: defaults in, consume type/disabled, add derived attrs at the call site.
    const merged = merge({ type: "button" }, props);
    const others = omit(merged, "type", "disabled");
    const isButton = () => (merged.as ?? "button") === "button";
    return merge(
      {
        as: "button",
        get role() {
          return isButton() ? undefined : "button";
        },
        get "data-disabled"() {
          return merged.disabled ? "" : undefined;
        }
      },
      others
    );
  }

  function polymorphic(props: Record<string, any>) {
    return omit(props, "as");
  }

  test("later layers shadow earlier ones and omitted keys stay hidden through re-merges", () => {
    const [label] = createSignal("Open");
    const [open] = createSignal(false);
    const props = compiledProps(label, open);
    const atPolymorphic = buttonRoot(props);
    // The user's as="a" (rightmost via `others`) beats Button.Root's as="button" default.
    expect(atPolymorphic.as).toBe("a");
    expect(atPolymorphic.role).toBe("button");
    // Consumed keys don't reappear once merged with new statics.
    expect("type" in atPolymorphic).toBe(false);
    expect("disabled" in atPolymorphic).toBe(false);
    expect((atPolymorphic as any).type).toBeUndefined();

    const element = polymorphic(atPolymorphic);
    expect("as" in element).toBe(false);
    expect(Object.keys(element).sort()).toEqual(
      ["aria-label", "class", "data-disabled", "href", "role"].sort()
    );
  });

  test("nested omits accumulate their hidden keys", () => {
    const rest = omit(omit(omit({ a: 1, b: 2, c: 3, d: 4 }, "a"), "b"), "c");
    expect(Object.keys(rest)).toEqual(["d"]);
    expect("a" in rest).toBe(false);
    expect("b" in rest).toBe(false);
    expect((rest as any).c).toBeUndefined();
    // …and a merge on top can't resurrect them.
    const remerged = merge({ e: 5 }, rest);
    expect(Object.keys(remerged).sort()).toEqual(["d", "e"]);
    expect("a" in remerged).toBe(false);
  });

  test("reactive reads stay live through every layer", () => {
    const [label, setLabel] = createSignal("Open");
    const [open, setOpen] = createSignal(false);
    const seen: string[] = [];
    createRoot(() => {
      const element = polymorphic(buttonRoot(compiledProps(label, open)));
      createEffect(
        () => `${element["aria-label"]}|${element["data-disabled"]}`,
        v => {
          seen.push(v);
        }
      );
    });
    flush();
    expect(seen).toEqual(["Open|undefined"]);
    setLabel("Close");
    setOpen(true);
    flush();
    expect(seen).toEqual(["Open|undefined", "Close|"]);
  });

  test("a spread copy of the chain result is a plain snapshot with the surviving keys", () => {
    const [label] = createSignal("Open");
    const [open] = createSignal(false);
    const element = polymorphic(buttonRoot(compiledProps(label, open)));
    const copy = { ...element };
    expect(copy).toEqual({
      class: "btn",
      href: "#row",
      "aria-label": "Open",
      role: "button",
      "data-disabled": undefined
    });
  });

  test("descriptor kind survives the chain: static stays data, reactive stays a getter", () => {
    const [label] = createSignal("Open");
    const [open] = createSignal(false);
    const element = polymorphic(buttonRoot(compiledProps(label, open)));
    // A consumer (spread's children fast path, isStatic) must be able to
    // tell a compiled static attribute from a reactive one at the bottom of
    // the chain — that distinction is the compiler's verdict and must not be
    // erased by the layers in between.
    const staticDesc = Object.getOwnPropertyDescriptor(element, "class")!;
    expect(staticDesc.get).toBeUndefined();
    expect(staticDesc.value).toBe("btn");
    const reactiveDesc = Object.getOwnPropertyDescriptor(element, "aria-label")!;
    expect(typeof reactiveDesc.get).toBe("function");
    expect(Object.getOwnPropertyDescriptor(element, "as")).toBeUndefined();
  });
});

describe("deep", () => {
  // RULED (INTERNALS-STORE-STATE.md, recon-snap pin 2): pins the LEGACY graph
  // shape (one $TRACK dep per level). The rewrite's deep() subscribes the
  // key-set node plus per-key nodes per level — deep tracking behavior is
  // covered behaviorally by the sibling tests. Skipped, not ported.
  test.skip("subscribes to $TRACK at each level", () => {
    const [state, setState] = createStore({ list: [{ a: 1 }, { b: 2 }] });
    let o: any;
    createRoot(() => {
      createEffect(
        () => {
          o = getOwner() as any;
          return deep(state);
        },
        v => {}
      );
    });
    flush();
    let count = 0;
    for (let d = o._deps; d !== null; d = d._nextDep) {
      count++;
    }
    // root, list array, {a:1}, {b:2}
    expect(count).toBe(4);
  });
  test("tests tracks deep updates", () => {
    const effect = vi.fn();
    const [state, setState] = createStore<{ list: Record<string, number>[] }>({
      list: [{ a: 1 }, { b: 2 }]
    });
    createRoot(() => {
      createEffect(
        () => deep(state),
        v => effect(v)
      );
    });
    expect(effect).toHaveBeenCalledTimes(0);
    flush();
    expect(effect).toHaveBeenCalledTimes(1);

    setState(s => {
      s.list[0].a = 2;
    });
    flush();
    expect(effect).toHaveBeenCalledTimes(2);
    expect(effect.mock.calls[1][0]).toEqual({ list: [{ a: 2 }, { b: 2 }] });
    setState(s => {
      s.list.push({ c: 3 });
    });
    flush();
    expect(effect).toHaveBeenCalledTimes(3);
    expect(effect.mock.calls[2][0]).toEqual({ list: [{ a: 2 }, { b: 2 }, { c: 3 }] });
    setState(s => {
      s.list = [{ d: 4 }];
    });
    flush();
    expect(effect).toHaveBeenCalledTimes(4);
    expect(effect.mock.calls[3][0]).toEqual({ list: [{ d: 4 }] });
  });

  test("tracks updates in a symbol-keyed subtree", () => {
    const meta = Symbol("meta");
    const [state, setState] = createStore({ [meta]: { value: 1 } });
    const values: number[] = [];

    createRoot(() => {
      createEffect(
        () => deep(state),
        value => {
          values.push(value[meta].value);
        }
      );
    });
    flush();

    setState(s => {
      s[meta].value = 2;
    });
    flush();

    expect(values).toEqual([1, 2]);
  });

  test("notifies on symbol key addition and deletion", () => {
    const meta = Symbol("meta");
    const [state, setState] = createStore<{ [meta]?: number }>({});
    const seen: (number | undefined)[] = [];

    createRoot(() => {
      createEffect(
        () => deep(state),
        value => {
          seen.push(value[meta]);
        }
      );
    });
    flush();

    setState(s => {
      s[meta] = 1;
    });
    flush();

    setState(s => {
      delete s[meta];
    });
    flush();

    expect(seen).toEqual([undefined, 1, undefined]);
  });
  test("handles shared references", () => {
    const sharedReference = {
      a: 1,
      b: 2
    };
    const sharedReference2 = {
      a: 1,
      b: 2
    };
    const effect = vi.fn();
    const [store, setStore] = createStore({
      first: {
        nested: { shared: sharedReference }
      },
      second: {
        nested: { shared: sharedReference }
      }
    });
    createRoot(() => {
      createEffect(() => deep(store.first), effect);
    });
    flush();
    expect(effect).toHaveBeenCalledTimes(1);
    setStore(s => {
      s.second.nested.shared.b = 3;
    });
    flush();
    expect(effect).toHaveBeenCalledTimes(2);
    setStore(s => {
      s.first.nested.shared = sharedReference2;
      s.second.nested.shared = sharedReference2;
    });
    flush();
    expect(effect).toHaveBeenCalledTimes(3);
    setStore(s => {
      s.second.nested.shared.b = 4;
    });
    flush();
    expect(effect).toHaveBeenCalledTimes(4);
  });
  test("returns plain (non-proxy) data", () => {
    const [state] = createStore({ a: { b: 1 }, c: [2, 3] });
    let result: any;
    createRoot(() => {
      createEffect(
        () => deep(state),
        v => {
          result = v;
        }
      );
    });
    flush();
    expect(result).toEqual({ a: { b: 1 }, c: [2, 3] });
    expect(result).not.toBe(state);
    expect(typeof result.a).toBe("object");
    expect(Array.isArray(result.c)).toBe(true);
  });
  test("works with reconcile", () => {
    const effect = vi.fn();
    const [state, setState] = createStore<{ list: { id: number; v: number }[] }>({
      list: [
        { id: 1, v: 10 },
        { id: 2, v: 20 }
      ]
    });
    createRoot(() => {
      createEffect(() => deep(state), effect);
    });
    flush();
    expect(effect).toHaveBeenCalledTimes(1);
    setState(
      reconcile(
        {
          list: [
            { id: 1, v: 99 },
            { id: 2, v: 20 },
            { id: 3, v: 30 }
          ]
        },
        "id"
      )
    );
    flush();
    expect(effect).toHaveBeenCalledTimes(2);
    expect(effect.mock.calls[1][0]).toEqual({
      list: [
        { id: 1, v: 99 },
        { id: 2, v: 20 },
        { id: 3, v: 30 }
      ]
    });
  });
});

describe("snapshot", () => {
  test("preserves array length when a trailing index was deleted", () => {
    const [state, setState] = createStore<(string | undefined)[]>(["a", "b", "c"]);
    setState(s => {
      delete s[2];
    });
    flush();
    expect(state.length).toBe(3); // proxy: plain-JS delete semantics

    const copy = snapshot(state);
    expect(copy.length).toBe(3); // the copy must agree with the store
    expect(2 in copy).toBe(false); // and keep the hole a hole, not undefined
    expect(JSON.stringify(copy)).toBe('["a","b",null]');
  });

  test("deep() preserves array length for trailing holes too", () => {
    const [state, setState] = createStore<(string | undefined)[]>(["a", "b", "c"]);
    setState(s => {
      delete s[2];
    });
    flush();
    createRoot(dispose => {
      const copy = deep(state);
      expect(copy.length).toBe(3);
      expect(2 in copy).toBe(false);
      dispose();
    });
  });

  test("preserves length for nested arrays and multi-hole runs", () => {
    const [state, setState] = createStore<{ list: (string | undefined)[] }>({
      list: ["a", "b", "c", "d"]
    });
    setState(s => {
      delete s.list[2];
      delete s.list[3];
    });
    flush();
    const copy = snapshot(state);
    expect(copy.list.length).toBe(4);
    expect(JSON.stringify(copy.list)).toBe('["a","b",null,null]');
  });

  test("middle holes and length truncation keep working (controls)", () => {
    const [mid, setMid] = createStore<(string | undefined)[]>(["a", "b", "c"]);
    setMid(s => {
      delete s[1];
    });
    flush();
    expect(JSON.stringify(snapshot(mid))).toBe('["a",null,"c"]');
    expect(snapshot(mid).length).toBe(3);

    const [cut, setCut] = createStore<string[]>(["a", "b", "c"]);
    setCut(s => {
      s.length = 2;
    });
    flush();
    expect(snapshot(cut).length).toBe(2);
    expect(JSON.stringify(snapshot(cut))).toBe('["a","b"]');
  });

  test("returns same object if unchanged", () => {
    const ref = { a: 1, b: 2 };
    const [state, setState] = createStore(ref);
    const immutable = snapshot(state);
    expect(immutable).not.toBe(state);
    expect(immutable).toEqual(state);
    expect(immutable).toBe(ref);
  });
  // snapshot reads the override directly and is intended as an untrack/deep
  // peek — it sees pending writes synchronously. Inside a reactive scope
  // tracked reads also resolve to the pending value (the compute is downstream
  // of the write), so both views agree; outside any scope tracked reads still
  // return the previous value until flush, and snapshot diverges by design.
  test("returns new object if changed", () => {
    const ref = { a: 1, b: 2 };
    const [state, setState] = createStore(ref);
    const immutable = snapshot(state);
    expect(immutable).not.toBe(state);
    expect(immutable).toEqual(state);
    expect(immutable).toBe(ref);

    setState(s => {
      s.a = 3;
    });
    const newImmutable = snapshot(state);
    expect(newImmutable).not.toBe(state);
    expect(newImmutable).toEqual({ a: 3, b: 2 });
    expect(newImmutable).not.toBe(immutable);
    expect(newImmutable).not.toEqual(immutable);
  });
  test("returns new object if nested changed", () => {
    const ref = { a: 1, b: { c: 2 } };
    const [state, setState] = createStore(ref);
    const immutable = snapshot(state);
    expect(immutable).not.toBe(state);
    expect(immutable).toEqual(state);
    expect(immutable).toBe(ref);

    setState(s => {
      s.b.c = 3;
    });
    const newImmutable = snapshot(state);
    expect(newImmutable).not.toBe(state);
    expect(newImmutable).toEqual({ a: 1, b: { c: 3 } });
    expect(newImmutable).not.toBe(immutable);
  });
  test("returns existing object if nested unchanged", () => {
    const ref = { a: 1, b: { c: 2 } };
    const [state, setState] = createStore(ref);
    const immutable = snapshot(state);
    expect(immutable).not.toBe(state);
    expect(immutable).toEqual(state);
    expect(immutable).toBe(ref);
    setState(s => {
      s.a = 3;
    });
    const newImmutable = snapshot(state);
    expect(newImmutable).not.toBe(state);
    expect(newImmutable).toEqual({ a: 3, b: { c: 2 } });
    expect(newImmutable).not.toBe(immutable);
    expect(newImmutable.b).toBe(immutable.b);
  });
  test("returns new object if nested array changed", () => {
    const ref = { a: 1, b: [2, 3] };
    const [state, setState] = createStore(ref);
    const immutable = snapshot(state);
    expect(immutable).not.toBe(state);
    expect(immutable).toEqual(state);
    expect(immutable).toBe(ref);
    setState(s => {
      s.b[0] = 4;
    });
    const newImmutable = snapshot(state);
    expect(newImmutable).not.toBe(state);
    expect(newImmutable).toEqual({ a: 1, b: [4, 3] });
    expect(newImmutable).not.toBe(immutable);
  });
});
