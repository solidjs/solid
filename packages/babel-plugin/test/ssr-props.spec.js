// SSR hoisted props shapes (src/ssr/props.ts, #3511): the compiled output is
// EXECUTED here, against a stub runtime, and compared with the literal form
// (`hoistProps: false`) — the fixtures only show the text.
const babel = require("@babel/core");
const plugin = require("../index");

const options = {
  moduleName: "r-server",
  generate: "ssr",
  requireImportSource: false
};

function compile(code, extra = {}) {
  return babel.transformSync(code, {
    configFile: false,
    babelrc: false,
    filename: "x.jsx",
    plugins: [[plugin, { ...options, ...extra }]]
  }).code;
}

const runtime = {
  ssr: (t, ...v) => ({ t, v }),
  escape: v => v,
  mergeProps: (...sources) => Object.assign({}, ...sources),
  memo: fn => fn,
  applyRef: (r, el) => r(el),
  // Dev output keeps the `createComponent` call (with the source name) the
  // production SSR output inlines to `Comp(props)`.
  createComponent: (Comp, props) => Comp(props)
};

/** Runs the module body with the imports bound to `runtime`; `__result` is what the snippet exposes. */
function run(code, extra = {}) {
  const out = compile(code, extra).replace(
    /import \{ ([\w$]+) as ([\w$]+) \} from "r-server";/g,
    "const $2 = __rt.$1;"
  );
  return new Function("__rt", `${out}\nreturn __result;`)(runtime);
}

/** Both forms, for parity assertions. */
function both(code) {
  return [run(code), run(code, { hoistProps: false })];
}

const shape = o => ({
  keys: Object.keys(o),
  proto: Object.getPrototypeOf(o),
  descriptors: Object.keys(o).map(k => {
    const d = Object.getOwnPropertyDescriptor(o, k);
    return [k, d.get ? "accessor" : "data", d.enumerable, d.configurable];
  })
});

describe("SSR hoisted props", () => {
  test("hoists a site inside a function; the instance is a plain object with the literal's own shape", () => {
    const code = `
      const Comp = p => p;
      function App(props) {
        const label = props.label;
        return <Comp as="a" label={label} count={props.n} static={1} />;
      }
      __result = App({ label: "L", n: 3 });
    `;
    const compiled = compile(code);
    expect(compiled).toMatch(/new _P\$\(/);
    expect(compiled).toMatch(/_P\$\.prototype = Object\.prototype/);
    const [hoisted, literal] = both(code);
    expect(shape(hoisted)).toEqual(shape(literal));
    expect(hoisted.proto).toBeUndefined();
    expect(Object.getPrototypeOf(hoisted)).toBe(Object.prototype);
    expect(hoisted.as).toBe("a");
    expect(hoisted.label).toBe("L");
    expect(hoisted.count).toBe(3);
    expect({ ...hoisted }).toMatchObject({ ...literal });
    expect(JSON.stringify(hoisted)).toBe(JSON.stringify(literal));
  });

  test("getters read live through the captured object; a data prop is a value", () => {
    const [hoisted, literal] = both(`
      const Comp = p => p;
      function App(props) {
        return <Comp value={props.value} />;
      }
      const src = { value: 1 };
      __result = [App(src), src];
    `);
    for (const [props, src] of [hoisted, literal]) {
      expect(props.value).toBe(1);
      src.value = 2;
      expect(props.value).toBe(2);
    }
  });

  test("a getter is defined only for a read through its object (the receiver contract)", () => {
    const props = run(`
      const Comp = p => p;
      function App(props) {
        return <Comp value={props.value} />;
      }
      __result = App({ value: 1 });
    `);
    const forwarded = Object.defineProperty(
      {},
      "value",
      Object.getOwnPropertyDescriptor(props, "value")
    );
    expect(() => forwarded.value).toThrow(TypeError);
    // Reading through a copy that re-homes the getter is fine.
    const rehomed = Object.defineProperty({}, "value", {
      get: Object.getOwnPropertyDescriptor(props, "value").get.bind(props),
      enumerable: true,
      configurable: true
    });
    expect(rehomed.value).toBe(1);
    // A spread copy carries the slot as an own symbol and its value.
    expect({ ...props }.value).toBe(1);
  });

  test("dev output names the contract instead of a TypeError", () => {
    const props = run(
      `
      const Comp = p => p;
      function App(props) {
        return <Comp value={props.value} />;
      }
      __result = App({ value: 1 });
    `,
      { dev: true }
    );
    const forwarded = Object.defineProperty(
      {},
      "value",
      Object.getOwnPropertyDescriptor(props, "value")
    );
    expect(() => forwarded.value).toThrow(
      /props getter was read on an object that is not its props/
    );
    expect(props.value).toBe(1);
  });

  test("a getter with no captures does not depend on its receiver", () => {
    const props = run(`
      const Comp = p => p;
      const state = { x: 1 };
      function App() {
        return <Comp value={state.x} />;
      }
      __result = App();
    `);
    const forwarded = Object.defineProperty(
      {},
      "value",
      Object.getOwnPropertyDescriptor(props, "value")
    );
    expect(forwarded.value).toBe(1);
  });

  test("ref is an own per-instance function that sees the captured bindings", () => {
    const [hoisted, literal] = both(`
      const Comp = p => p;
      function App(props) {
        let el;
        const seen = [];
        const out = <Comp ref={props.onRef} value={1} />;
        return [out, seen];
      }
      const calls = [];
      __result = [App({ onRef: el => calls.push(el) }), calls];
    `);
    for (const [[props], calls] of [hoisted, literal]) {
      expect(typeof props.ref).toBe("function");
      expect(Object.getOwnPropertyDescriptor(props, "ref").get).toBeUndefined();
      props.ref("el");
      expect(calls).toContain("el");
    }
    expect(Object.keys(hoisted[0][0])).toEqual(Object.keys(literal[0][0]));
  });

  test("a ref that assigns a local keeps the literal", () => {
    const compiled = compile(`
      const Comp = p => p;
      function App() {
        let el;
        return <Comp ref={el} value={1} />;
      }
    `);
    expect(compiled).not.toMatch(/new _P\$/);
  });

  test("nested sites: the inner one hoists first and the outer body constructs it", () => {
    const code = `
      const Comp = p => p;
      const Inner = p => p;
      function App(props) {
        return (
          <Comp value={props.value}>
            <Inner label={props.label} />
          </Comp>
        );
      }
      __result = App({ value: 1, label: "L" });
    `;
    const compiled = compile(code);
    expect(compiled.match(/function _P\$\d*\(/g)).toHaveLength(2);
    const [hoisted, literal] = both(code);
    expect(hoisted.children.label).toBe("L");
    expect(literal.children.label).toBe("L");
    expect(shape(hoisted.children)).toEqual(shape(literal.children));
  });

  test("a compiled template temp moves into the getter that owns it", () => {
    const code = `
      const Comp = p => p;
      function App(props) {
        return <Comp><div>{props.text}</div></Comp>;
      }
      __result = App({ text: "T" });
    `;
    const compiled = compile(code);
    expect(compiled).toMatch(/var _v\$;\s*return/);
    // the function-level declaration is gone
    expect(compiled).not.toMatch(/function App\(props\) \{\s*var _v\$/);
    const [hoisted, literal] = both(code);
    expect(hoisted.children.t).toEqual(literal.children.t);
    // the hole is a thunk over the captured `props`
    expect(hoisted.children.v[0]()).toBe("T");
    expect(literal.children.v[0]()).toBe("T");
  });

  test("a site under mergeProps hoists the literal argument", () => {
    const code = `
      const Comp = p => p;
      function App(props) {
        return <Comp {...props} label={props.label} />;
      }
      __result = App({ a: 1, label: "L" });
    `;
    expect(compile(code)).toMatch(/_\$mergeProps\(props, new _P\$\(props\)\)/);
    const [hoisted, literal] = both(code);
    expect(hoisted).toMatchObject({ a: 1, label: "L" });
    expect(Object.keys(hoisted)).toEqual(Object.keys(literal));
  });

  describe("keeps the literal when a capture would change meaning", () => {
    const cases = {
      "a reassigned local": `
        function App(props) {
          let mode = "a";
          mode = props.mode;
          return <Comp value={mode.x} />;
        }`,
      "a loop counter": `
        function App(list) {
          const out = [];
          for (let i = 0; i < list.length; i++) out.push(<Comp value={list[i]} />);
          return out;
        }`,
      "a binding declared after the site": `
        function App(props) {
          const el = <Comp value={later.x} />;
          const later = props.value;
          return el;
        }`,
      "a binding whose initializer holds the site": `
        function App(props) {
          const self = <Comp value={self.x} />;
          return self;
        }`,
      arguments: `
        function App() {
          return <Comp value={arguments[0]} />;
        }`,
      "a var assigned inside the getter": `
        function App(props) {
          var last;
          return <Comp value={(last = props.value)} />;
        }`
    };
    for (const [name, body] of Object.entries(cases)) {
      test(name, () => {
        const compiled = compile(`const Comp = p => p;\n${body}`);
        expect(compiled).not.toMatch(/new _P\$/);
        expect(compiled).toMatch(/get value\(\)/);
      });
    }
  });

  test("a module-level site stays a literal (built once)", () => {
    const compiled = compile(`
      const Comp = p => p;
      const state = { x: 1 };
      const a = <Comp value={state.x} />;
    `);
    expect(compiled).not.toMatch(/new _P\$/);
  });

  test("a site with only data props stays a literal", () => {
    const compiled = compile(`
      const Comp = p => p;
      function App() {
        return <Comp as="a" n={1} />;
      }
    `);
    expect(compiled).not.toMatch(/new _P\$/);
  });

  test("a for-of const and a module binding are captured or read live", () => {
    const [hoisted, literal] = both(`
      const Comp = p => p;
      let shared = { x: "s" };
      function App(items) {
        const out = [];
        for (const item of items) out.push(<Comp value={item.v} tag={shared.x} />);
        shared = { x: "changed" };
        return out;
      }
      __result = App([{ v: 1 }, { v: 2 }]);
    `);
    expect(hoisted.map(p => p.value)).toEqual([1, 2]);
    expect(literal.map(p => p.value)).toEqual([1, 2]);
    // a module-level `let` is read at access time in both forms
    expect(hoisted.map(p => p.tag)).toEqual(["changed", "changed"]);
    expect(literal.map(p => p.tag)).toEqual(["changed", "changed"]);
  });

  test("this in a class method captures the compiler's _self$", () => {
    const [hoisted, literal] = both(`
      const Comp = p => p;
      class View {
        constructor() { this.value = 7; }
        render() { return <Comp value={this.value} />; }
      }
      __result = new View().render();
    `);
    expect(hoisted.value).toBe(7);
    expect(literal.value).toBe(7);
  });

  test("hoistProps: false keeps every site a literal", () => {
    const compiled = compile(
      `
      const Comp = p => p;
      function App(props) { return <Comp value={props.value} />; }
    `,
      { hoistProps: false }
    );
    expect(compiled).not.toMatch(/_P\$/);
  });

  test("DOM output is untouched", () => {
    const compiled = babel.transformSync(
      `
      const Comp = p => p;
      function App(props) { return <Comp value={props.value} />; }
    `,
      {
        configFile: false,
        babelrc: false,
        filename: "x.jsx",
        plugins: [[plugin, { moduleName: "r-dom", generate: "dom", requireImportSource: false }]]
      }
    ).code;
    expect(compiled).not.toMatch(/_P\$/);
    expect(compiled).toMatch(/get value\(\)/);
  });
});
