const path = require("path");
const { runFixtures } = require("./fixtures");
const plugin = require("../index");

// `sourceNames: true` — every kind on: component labels as `createComponent`'s
// third argument and binding effects named by what they write.
runFixtures({
  plugin,
  pluginOptions: {
    moduleName: "r-dom",
    builtIns: ["For", "Show"],
    generate: "dom",
    sourceNames: true,
    contextToCustomElements: true
  },
  title: "Convert JSX (sourceNames)",
  fixtures: path.join(__dirname, "__dom_source_names_fixtures__")
});

// `sourceNames` follows `dev` when unset; `@solidjs/compiler`'s
// `transform.test.js` asserts the same on the same source.
describe("sourceNames defaults", () => {
  const babel = require("@babel/core");
  const code = "const view = <div class={cls()}><Home /></div>;";
  // A prefix: with `locations` (also following `dev`) a fourth argument follows.
  const label = '_$createComponent(Home, {}, "Home"';
  const binding = 'name: "div.class"';
  const compile = opts =>
    babel.transformSync(code, {
      configFile: false,
      babelrc: false,
      filename: "input.jsx",
      plugins: [[plugin, { moduleName: "r-dom", ...opts }]]
    }).code;

  test("unset follows dev: every kind on in dev, off otherwise", () => {
    const dev = compile({ dev: true });
    expect(dev).toContain(label);
    expect(dev).toContain(binding);
    const prod = compile({ dev: false });
    expect(prod).not.toContain('"Home"');
    expect(prod).not.toContain("name:");
    expect(prod).toBe(compile({}));
  });

  test("production output is byte-identical with the option set or unset", () => {
    expect(compile({ dev: false })).toBe(compile({ dev: false, sourceNames: false }));
    expect(compile({ dev: false })).toBe(compile({ dev: false, sourceNames: {} }));
  });

  test("`false` opts out in dev; the object form's unspecified kinds follow dev", () => {
    const off = compile({ dev: true, sourceNames: false });
    expect(off).not.toContain('"Home"');
    expect(off).not.toContain("name:");
    const picked = compile({ dev: true, sourceNames: { components: false } });
    expect(picked).not.toContain('"Home"');
    expect(picked).toContain(binding);
    const prodPicked = compile({ dev: false, sourceNames: { components: true } });
    expect(prodPicked).toContain(label);
    expect(prodPicked).not.toContain(binding);
  });
});

// `sourceNames.locations` follows `dev` like the other kinds; a location is
// only emitted beside a label, and never without a `filename`.
describe("sourceNames locations defaults", () => {
  const babel = require("@babel/core");
  const code = "const view = <div class={cls()}><Home /></div>;";
  const label = '_$createComponent(Home, {}, "Home", "input.jsx:1:33")';
  const binding = 'loc: "input.jsx:1:19"';
  const compile = (opts, filename = "input.jsx") =>
    babel.transformSync(code, {
      configFile: false,
      babelrc: false,
      ...(filename ? { filename } : {}),
      plugins: [[plugin, { moduleName: "r-dom", ...opts }]]
    }).code;

  test("unset follows dev: on in dev, off otherwise", () => {
    const dev = compile({ dev: true });
    expect(dev).toContain(label);
    expect(dev).toContain(binding);
    const prod = compile({ dev: false });
    expect(prod).not.toContain("input.jsx");
    expect(prod).not.toContain("loc:");
    expect(prod).toBe(compile({}));
  });

  test("`{ locations: false }` in dev drops only the locations", () => {
    const named = compile({ dev: true, sourceNames: { locations: false } });
    expect(named).toContain('_$createComponent(Home, {}, "Home")');
    expect(named).toContain('name: "div.class"');
    expect(named).not.toContain("input.jsx");
    expect(named).not.toContain("loc:");
    expect(named).toBe(
      compile({ dev: true, sourceNames: { components: true, bindings: true, locations: false } })
    );
  });

  test("a location rides only with its label", () => {
    const components = compile({ dev: false, sourceNames: { components: true, locations: true } });
    expect(components).toContain(label);
    expect(components).not.toContain("name:");
    expect(components).not.toContain("loc:");
    const bindings = compile({ dev: false, sourceNames: { bindings: true, locations: true } });
    expect(bindings).toContain(binding);
    expect(bindings).not.toContain('"Home"');
  });

  test("no `filename` → no location, even with the kind on", () => {
    const out = compile({ dev: true, sourceNames: true }, null);
    expect(out).toContain('_$createComponent(Home, {}, "Home")');
    expect(out).toContain('name: "div.class"');
    expect(out).not.toContain("loc:");
  });

  test("the path is relative to `root`, posix, with `..` outside it", () => {
    const abs = require("path").resolve("src/App.jsx");
    expect(compile({ dev: true }, abs)).toContain('"src/App.jsx:1:33"');
    expect(compile({ dev: true, root: "src" }, abs)).toContain('"App.jsx:1:33"');
    expect(compile({ dev: true, root: "test" }, abs)).toContain('"../src/App.jsx:1:33"');
  });
});
