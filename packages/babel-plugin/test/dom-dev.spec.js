const path = require("path");
const babel = require("@babel/core");
const { runFixtures } = require("./fixtures");
const plugin = require("../index");

const pluginOptions = {
  moduleName: "r-dom",
  builtIns: ["For", "Show"],
  generate: "dom",
  dev: true,
  contextToCustomElements: true
};

runFixtures({
  plugin,
  pluginOptions,
  title: "Convert JSX (dev)",
  fixtures: path.join(__dirname, "__dom_dev_fixtures__")
});

// The dev-only stateful property helper (#4186) must never reach
// production output: the same source compiled with `dev: false` keeps the
// inline assignments it always had.
describe("setStatefulProperty is dev-only", () => {
  const code = `
    const a = <input class={cls()} value={props.name} />;
    const b = <input checked={on()} />;
    const c = <video muted={m()} />;
    const d = <option selected={s()} />;
    const e = <textarea value={v()} />;
  `;
  const compile = options =>
    babel.transformSync(code, {
      babelrc: false,
      configFile: false,
      filename: "stateful.jsx",
      plugins: [[plugin, { ...pluginOptions, ...options }]]
    }).code;

  test("production DOM output inlines the writes", () => {
    const output = compile({ dev: false });
    expect(output).not.toContain("setStatefulProperty");
    expect(output).toContain('_el$.value = t ?? "";');
    expect(output).toContain("_el$2.checked = _v$;");
    expect(output).toContain("_el$3.muted = _v$;");
    expect(output).toContain("_el$4.selected = _v$;");
    expect(output).toContain('_el$5.value = _v$ ?? "";');
  });

  test("dev DOM output routes them through setStatefulProperty", () => {
    const output = compile({ dev: true });
    expect(output).toContain('_$setStatefulProperty(_el$, "value", t ?? "");');
    expect(output).toContain('_$setStatefulProperty(_el$2, "checked", _v$);');
    expect(output).toContain('_$setStatefulProperty(_el$3, "muted", _v$);');
    expect(output).toContain('_$setStatefulProperty(_el$4, "selected", _v$);');
    expect(output).toContain('_$setStatefulProperty(_el$5, "value", _v$ ?? "");');
  });

  test("dev hydratable output keeps setProperty, which carries the check itself", () => {
    const output = compile({ dev: true, hydratable: true });
    expect(output).not.toContain("setStatefulProperty");
    expect(output).toContain('_$setProperty(_el$2, "checked", _v$);');
  });

  test("other generates never import it", () => {
    for (const generate of ["ssr", "universal", "dynamic"]) {
      expect(compile({ dev: true, generate })).not.toContain("setStatefulProperty");
    }
  });
});
