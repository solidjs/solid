// JSX in a later declarator of one declaration (`const a = 1, b = <div/>`,
// the shape minifiers make by joining declarations) must have its setup run
// after the declarators before it (#5102). The compiled output is EXECUTED
// against a stub runtime whose `insert`, `ssr` and attribute writes read
// their values at once, so setup hoisted above the declaration throws.
const babel = require("@babel/core");
const plugin = require("../index");

const modes = {
  dom: { moduleName: "r-dom", generate: "dom" },
  "dom hydratable": { moduleName: "r-dom", generate: "dom", hydratable: true },
  universal: { moduleName: "r-custom", generate: "universal" },
  ssr: { moduleName: "r-server", generate: "ssr" }
};

const source = `
  function mk(s) { return s; }
  function Attr() {
    const label = mk("hi"), onClick = () => label, view = <div title={label} onClick={onClick}>x</div>;
    return view;
  }
  function Child() {
    const label = mk("hi"), view = <p>{label}</p>;
    return view;
  }
  function Two() {
    const first = <i>a</i>, label = mk("hi"), second = <p>{first}{label}</p>;
    return second;
  }
  let label = mk("hi"), view = <p title={label}>{label}</p>;
  export const exported = mk("hi"), exportedView = <p>{exported}</p>;
  __result = { Attr, Child, Two, view, exported, exportedView };
`;

// Every DOM walk (`firstChild`, `nextSibling`) lands on another stub node.
const stub = new Proxy({}, { get: (_t, key) => (key === Symbol.toPrimitive ? undefined : stub) });
const node = () => stub;
const read = v => (typeof v === "function" ? v() : v);
const runtime = {
  template: () => node,
  createElement: node,
  createTextNode: node,
  getNextElement: template => template(),
  getNextMarker: () => [stub, []],
  runHydrationEvents: () => {},
  insert: (_parent, value) => read(value),
  insertNode: () => {},
  setProp: (_node, _name, value) => read(value),
  setAttribute: (_node, _name, value) => read(value),
  addEvent: (_node, _name, handler) => read(handler),
  delegateEvents: () => {},
  ssr: (_template, ...values) => values.map(read),
  ssrAttribute: (_name, value) => read(value),
  escape: v => v
};

function compile(options) {
  return babel.transformSync(source, {
    configFile: false,
    babelrc: false,
    filename: "x.jsx",
    sourceType: "module",
    plugins: [[plugin, { requireImportSource: false, ...options }]]
  }).code;
}

function run(options) {
  const out = compile(options)
    .replace(/import \{ ([\w$]+) as ([\w$]+) \} from "[\w-]+";/g, (_, name, local) => {
      if (!(name in runtime)) throw new Error(`stub runtime lacks ${name}`);
      return `const ${local} = __rt.${name};`;
    })
    .replace(/^export /gm, "");
  return new Function("__rt", `let __result;\n${out}\nreturn __result;`)(runtime);
}

describe.each(Object.entries(modes))("JSX in a later declarator (%s)", (_mode, options) => {
  test("setup runs after the declarators before it", () => {
    const result = run(options);
    expect(() => result.Attr()).not.toThrow();
    expect(() => result.Child()).not.toThrow();
    expect(() => result.Two()).not.toThrow();
  });

  test("the split keeps every declarator, exported ones included", () => {
    const out = compile(options);
    expect(out).toMatch(/export const exported = mk\("hi"\);/);
    expect(out).toMatch(/export const exportedView = /);
    expect(out).toMatch(/let label = mk\("hi"\);/);
  });
});
