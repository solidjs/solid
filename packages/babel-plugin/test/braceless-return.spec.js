// A returned element's setup belongs inside the braceless `if`, `else` or
// loop body that returns it: built only when that branch runs, and inside the
// loop that binds its variables. The compiled output is EXECUTED here against
// a stub runtime whose `insert` and `ssr` evaluate their expressions at once,
// so setup that escapes its branch throws.
const babel = require("@babel/core");
const plugin = require("../index");

const modes = {
  dom: { moduleName: "r-dom", generate: "dom" },
  "dom hydratable": { moduleName: "r-dom", generate: "dom", hydratable: true },
  universal: { moduleName: "r-custom", generate: "universal" },
  ssr: { moduleName: "r-server", generate: "ssr" }
};

const source = `
  function Branch(props) {
    if (props.list) return <span>{props.list.join(", ")}</span>;
    else return <div>{props.empty}</div>;
  }
  function Loop(props) {
    for (const item of props.items) return <span>{item.name}</span>;
  }
  function Nested(props) {
    outer: for (const row of props.rows)
      for (const cell of row) if (cell) return <span>{cell.name}</span>;
  }
  __result = { Branch, Loop, Nested };
`;

const node = () => ({});
const runtime = {
  template: () => node,
  createElement: node,
  getNextElement: template => template(),
  insert: (_parent, value) => (typeof value === "function" ? value() : value),
  scope: fn => fn,
  ssr: (_template, ...values) => values.map(v => (typeof v === "function" ? v() : v)),
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

describe.each(Object.entries(modes))("braceless return bodies (%s)", (_mode, options) => {
  test("an untaken `if` branch builds nothing", () => {
    const { Branch } = run(options);
    expect(() => Branch({ empty: "none" })).not.toThrow();
    expect(() => Branch({ list: ["a", "b"] })).not.toThrow();
  });

  test("a loop body reads its loop variable in scope", () => {
    const { Loop, Nested } = run(options);
    expect(() => Loop({ items: [{ name: "a" }] })).not.toThrow();
    expect(() => Nested({ rows: [[null, { name: "b" }]] })).not.toThrow();
  });
});
