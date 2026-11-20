// #5102: JSX in a later declarator of a multi-declarator statement must not
// have its setup hoisted above the statement, where it would read the earlier
// declarators before they are initialized. Minifiers join consecutive
// declarations, so library builds that ship preserved JSX hit this shape. The
// compiled output is EXECUTED here against a stub runtime whose `insert`,
// effects and `ssr` evaluate their expressions at once, so setup that runs
// ahead of a declarator it reads throws.
const babel = require("@babel/core");
const plugin = require("../index");

const modes = {
  dom: { moduleName: "r-dom", generate: "dom" },
  "dom hydratable": { moduleName: "r-dom", generate: "dom", hydratable: true },
  universal: { moduleName: "r-custom", generate: "universal" },
  ssr: { moduleName: "r-server", generate: "ssr" }
};

const source = `
  function Attr(props) {
    const label = props.label,
      onClick = () => label,
      view = <div title={label} onClick={onClick} />;
    return view;
  }
  function Child(props) {
    const label = props.label,
      view = <p>{label}</p>;
    return view;
  }
  function Uninitialized(props) {
    let label,
      view = <p>{label}</p>;
    return view;
  }
  function Var(props) {
    var label = props.label,
      view = <p>{label}</p>;
    return label === undefined ? null : view;
  }
  function Both(props) {
    const first = <b>{props.label}</b>,
      label = props.label,
      second = <i>{label}</i>;
    return [first, second];
  }
  function TwoRoots(props) {
    const a = <div>{props.x()}</div>,
      b = <p>{props.y()}</p>;
    return [a, b];
  }
  __result = { Attr, Child, Uninitialized, Var, Both, TwoRoots };
`;

const node = () => ({});
const runtime = {
  template: () => node,
  createElement: node,
  getNextElement: template => template(),
  insert: (_parent, value) => (typeof value === "function" ? value() : value),
  setAttribute: () => {},
  setProp: () => {},
  addEventListener: () => {},
  delegateEvents: () => {},
  runHydrationEvents: () => {},
  effect: (compute, apply) => apply(compute()),
  scope: fn => fn,
  ssr: (_template, ...values) => values.map(v => (typeof v === "function" ? v() : v)),
  ssrAttribute: (name, value) => `${name}=${value}`,
  escape: v => v
};

function compile(options) {
  return babel.transformSync(source, {
    configFile: false,
    babelrc: false,
    filename: "x.jsx",
    plugins: [[plugin, { requireImportSource: false, ...options }]]
  }).code;
}

function run(options) {
  const out = compile(options).replace(
    /import \{ ([\w$]+) as ([\w$]+) \} from "[\w-]+";/g,
    (_, name, local) => {
      if (!(name in runtime)) throw new Error(`stub runtime lacks ${name}`);
      return `const ${local} = __rt.${name};`;
    }
  );
  return new Function("__rt", `let __result;\n${out}\nreturn __result;`)(runtime);
}

describe.each(Object.entries(modes))("JSX in a later declarator (%s)", (_mode, options) => {
  test("reads earlier declarators after they are initialized", () => {
    const fns = run(options);
    for (const [name, fn] of Object.entries(fns)) {
      expect(() => fn({ label: "hi", x: () => 1, y: () => 2 }), name).not.toThrow();
    }
  });

  test("the first declarator's setup still goes before the statement", () => {
    const out = compile(options);
    const both = out.slice(out.indexOf("function Both"));
    expect(both.indexOf("const first")).toBeGreaterThan(0);
    expect(both.slice(0, both.indexOf("const first"))).toMatch(/var _/);
  });
});
