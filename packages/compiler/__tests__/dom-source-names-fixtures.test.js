const fs = require("fs");
const path = require("path");
const { transform } = require("../index");

const babelFixtures = path.resolve(
  __dirname,
  "../../babel-plugin/test/__dom_source_names_fixtures__"
);
const oxcFixtures = path.resolve(__dirname, "fixtures/dom-source-names");

const fixtureParity = {
  bindings: "subset",
  components: "subset",
  locations: "subset",
  ssr: "subset"
};

const suiteOptions = {
  moduleName: "r-dom",
  builtIns: ["For", "Show"],
  generate: "dom",
  sourceNames: true,
  contextToCustomElements: true
};

// A fixture's source is the Babel plugin's; a copy next to the output
// (`<fixture>/code.js`, `<fixture>/options.json`) stands in until the Babel
// fixture lands here.
function fixtureFile(fixture, name) {
  const babelFile = path.join(babelFixtures, fixture, name);
  return fs.existsSync(babelFile) ? babelFile : path.join(oxcFixtures, fixture, name);
}

function readFixture(name) {
  return fs.readFileSync(fixtureFile(name, "code.js"), "utf8");
}

// Mirrors the Babel fixture runner's per-fixture `options.json` layering.
function fixtureOptions(fixture) {
  const file = fixtureFile(fixture, "options.json");
  return fs.existsSync(file)
    ? { ...suiteOptions, ...JSON.parse(fs.readFileSync(file, "utf8")) }
    : suiteOptions;
}

// A fixture that sets `root` (the `locations` one) is named the way the
// Babel runner names it — `<root>/<fixture>/code.<ext>` — so the location
// strings read `locations/code.jsx:8:3`, the Babel snapshot's path up to the
// extension (Babel parses JSX in `.js`; here the extension picks the parser).
function fixtureFilename(fixture, options) {
  return options.root ? `${options.root}/${fixture}/code.jsx` : `${fixture}.jsx`;
}

function transformFixture(code, fixture) {
  const options = fixtureOptions(fixture);
  return (
    transform(code, { filename: fixtureFilename(fixture, options), ...options }).code.trimEnd() +
    "\n"
  );
}

function outputFixturePath(fixture) {
  return path.join(oxcFixtures, fixture, "output.js");
}

function readOutputFixture(fixture) {
  return fs.readFileSync(outputFixturePath(fixture), "utf8");
}

function writeOutputFixture(fixture, output) {
  fs.mkdirSync(path.dirname(outputFixturePath(fixture)), { recursive: true });
  fs.writeFileSync(outputFixturePath(fixture), output);
}

describe("AST-native Babel DOM sourceNames fixture reuse", () => {
  it("classifies supported Babel DOM sourceNames fixtures", () => {
    const sources = dir =>
      fs
        .readdirSync(dir, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .filter(entry => fs.existsSync(path.join(dir, entry.name, "code.js")))
        .map(entry => entry.name);
    const actual = [...new Set([...sources(babelFixtures), ...sources(oxcFixtures)])].sort();
    expect(Object.keys(fixtureParity).sort()).toEqual(actual);
  });

  it.each(Object.keys(fixtureParity))(
    "matches generated Oxc output for supported Babel DOM sourceNames fixture subset: %s",
    fixture => {
      const output = transformFixture(readFixture(fixture), fixture);
      if (process.env.UPDATE_OXC_FIXTURES === "1") {
        writeOutputFixture(fixture, output);
      }
      expect(output).toBe(readOutputFixture(fixture));
    }
  );

  it("emits no label without the option", () => {
    const { code } = transform(readFixture("components"), {
      filename: "components.jsx",
      ...suiteOptions,
      sourceNames: false
    });
    expect(code).not.toContain('"Child"');
  });

  // SSR keeps the `createComponent` wrapper only for the label; without the
  // option it inlines `Comp(props)` and imports no `createComponent`.
  it("SSR inlines the component call without the option", () => {
    const { code } = transform(readFixture("ssr"), {
      filename: "ssr.jsx",
      ...fixtureOptions("ssr"),
      sourceNames: false
    });
    expect(code).not.toContain("createComponent");
    expect(code).not.toContain('"Child"');
    expect(code).toContain("Child({");
  });
});

// `sourceNames.locations` follows `dev` like the other kinds; a location is
// only emitted beside a label, and never without a `filename`. Same source,
// same expectations as the Babel plugin's `sourceNames locations defaults`.
describe("sourceNames locations defaults", () => {
  const code = "const view = <div class={cls()}><Home /></div>;";
  const label = '_$createComponent(Home, {}, "Home", "input.jsx:1:33")';
  const binding = 'loc: "input.jsx:1:19"';
  const compile = (opts, filename = "input.jsx") =>
    transform(code, { moduleName: "r-dom", ...(filename ? { filename } : {}), ...opts }).code;

  it("unset follows dev: on in dev, off otherwise", () => {
    const dev = compile({ dev: true });
    expect(dev).toContain(label);
    expect(dev).toContain(binding);
    const prod = compile({ dev: false });
    expect(prod).not.toContain("input.jsx");
    expect(prod).not.toContain("loc:");
    expect(prod).toBe(compile({}));
  });

  it("`{ locations: false }` in dev drops only the locations", () => {
    const named = compile({ dev: true, sourceNames: { locations: false } });
    expect(named).toContain('_$createComponent(Home, {}, "Home")');
    expect(named).toContain('name: "div.class"');
    expect(named).not.toContain("input.jsx");
    expect(named).not.toContain("loc:");
    expect(named).toBe(
      compile({ dev: true, sourceNames: { components: true, bindings: true, locations: false } })
    );
  });

  it("a location rides only with its label", () => {
    const components = compile({ dev: false, sourceNames: { components: true, locations: true } });
    expect(components).toContain(label);
    expect(components).not.toContain("name:");
    expect(components).not.toContain("loc:");
    const bindings = compile({ dev: false, sourceNames: { bindings: true, locations: true } });
    expect(bindings).toContain(binding);
    expect(bindings).not.toContain('"Home"');
  });

  it("no `filename` → no location, even with the kind on", () => {
    const out = compile({ dev: true, sourceNames: true }, null);
    expect(out).toContain('_$createComponent(Home, {}, "Home")');
    expect(out).toContain('name: "div.class"');
    expect(out).not.toContain("loc:");
  });

  it("the path is relative to `root`, posix, with `..` outside it", () => {
    const abs = path.resolve("src/App.jsx");
    expect(compile({ dev: true }, abs)).toContain('"src/App.jsx:1:33"');
    expect(compile({ dev: true, root: "src" }, abs)).toContain('"App.jsx:1:33"');
    expect(compile({ dev: true, root: path.resolve("src") }, abs)).toContain('"App.jsx:1:33"');
    expect(compile({ dev: true, root: "test" }, abs)).toContain('"../src/App.jsx:1:33"');
  });

  it("SSR output carries the location as the fourth argument too", () => {
    const out = compile({ dev: true, generate: "ssr" });
    expect(out).toContain(label);
  });

  it("validates `root` and the `locations` kind", () => {
    expect(() => compile({ root: 1 })).toThrow("`root` option must be a string");
    expect(() => compile({ sourceNames: { locations: "yes" } })).toThrow(
      "`sourceNames.locations` must be boolean"
    );
  });
});
