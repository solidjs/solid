import {
  createRoot,
  createComponent,
  mergeProps,
  splitProps,
  createUniqueId,
  createSignal,
  createComputed
} from "../src";
import { createStore } from "../store/src";

type SimplePropTypes = {
  a?: string | null;
  b?: string | null;
  c?: string | null;
  d?: string | null;
};

const Comp = (props: { greeting: string; name: string }) => `${props.greeting} ${props.name}`;

const Comp2 = (props: { greeting: string; name: string; optional?: string }) => {
  const [p, q] = splitProps(props, ["greeting", "optional"]);
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
  const [state, setState] = createStore<{ a: string; b: string; c?: string }>({ a: "Hi", b: "Jo" });
  const clone = mergeProps(state);
  expect(clone.a).toBe("Hi");
  expect(clone.b).toBe("Jo");
  setState({ a: "Greetings", c: "John" });
  expect(clone.a).toBe("Greetings");
  expect(clone.b).toBe("Jo");
  expect(clone.c).toBe("John");
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
    const props = mergeProps(defaults, s);
    const res: string[] = [];
    createRoot(() => {
      createComputed(() => {
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
