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
  const label = '_$createComponent(Home, {}, "Home")';
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
