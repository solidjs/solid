// #5102: JSX in a later declarator of a multi-declarator statement must not
// have its setup hoisted above the statement, where it would read the earlier
// declarators before they are initialized. The compiled output is EXECUTED
// against a stub runtime whose `insert`, effects and `ssr` evaluate their
// expressions at once, so setup that runs ahead of a declarator it reads
// throws. Mirrors babel-plugin/test/multi-declarator.spec.js.
const { transform } = require("../index");
const { modes, compileBabel, compileOxc, normalize, unifiedDiff } = require("./parity/harness");

const execModes = {
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
  addEvent: () => {},
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
  return transform(source, { filename: "x.jsx", requireImportSource: false, ...options }).code;
}

function run(options) {
  const out = compile(options).replace(/import \{([^}]*)\} from "[\w-]+";/g, (_, specifiers) =>
    specifiers
      .split(",")
      .map(s => s.trim())
      .filter(Boolean)
      .map(s => {
        const [name, local = name] = s.split(/\s+as\s+/);
        if (!(name in runtime)) throw new Error(`stub runtime lacks ${name}`);
        return `const ${local} = __rt.${name};`;
      })
      .join("\n")
  );
  return new Function("__rt", `let __result;\n${out}\nreturn __result;`)(runtime);
}

describe.each(Object.entries(execModes))("JSX in a later declarator (%s)", (_mode, options) => {
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

describe.each(["dom", "dom-hydratable", "ssr", "universal"])(
  "JSX in a later declarator matches Babel (%s)",
  mode => {
    test("normalized output is identical", () => {
      // `Attr` is left out: Oxc collects a declaration's bindings only after
      // the whole statement, so a handler declared in the same statement is
      // not known to be a function and is bound with `addEvent`, where Babel
      // assigns `$$click`. That divergence is separate from the hoist.
      const parity = source.replace(/function Attr[\s\S]*?\n  }\n/, "");
      const options = modes[mode].options;
      const babel = normalize(compileBabel(parity, options, "multi-declarator.jsx"));
      const oxc = normalize(compileOxc(parity, "multi-declarator", options));
      if (babel !== oxc) {
        throw new Error(`${mode} diverges (babel = "-", oxc = "+").\n` + unifiedDiff(babel, oxc));
      }
    });
  }
);
