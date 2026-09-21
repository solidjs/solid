const fs = require("fs");
const path = require("path");
const { transform } = require("../index");

const babelFixtures = path.resolve(
  __dirname,
  "../../babel-plugin/test/__dom_component_names_fixtures__"
);
const oxcFixtures = path.resolve(__dirname, "fixtures/dom-component-names");

const fixtureParity = {
  components: "subset",
  ssr: "subset"
};

const suiteOptions = {
  moduleName: "r-dom",
  builtIns: ["For", "Show"],
  generate: "dom",
  sourceNames: { components: true },
  contextToCustomElements: true
};

function readFixture(name) {
  return fs.readFileSync(path.join(babelFixtures, name, "code.js"), "utf8");
}

// Mirrors the Babel fixture runner's per-fixture `options.json` layering.
function fixtureOptions(fixture) {
  const file = path.join(babelFixtures, fixture, "options.json");
  return fs.existsSync(file)
    ? { ...suiteOptions, ...JSON.parse(fs.readFileSync(file, "utf8")) }
    : suiteOptions;
}

function transformFixture(code, fixture) {
  return (
    transform(code, { filename: `${fixture}.jsx`, ...fixtureOptions(fixture) }).code.trimEnd() +
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

describe("AST-native Babel DOM sourceNames.components fixture reuse", () => {
  it("classifies supported Babel DOM sourceNames.components fixtures", () => {
    const actual = fs
      .readdirSync(babelFixtures, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .filter(entry => fs.existsSync(path.join(babelFixtures, entry.name, "code.js")))
      .map(entry => entry.name)
      .sort();
    expect(Object.keys(fixtureParity).sort()).toEqual(actual);
  });

  it.each(Object.keys(fixtureParity))(
    "matches generated Oxc output for supported Babel DOM sourceNames.components fixture subset: %s",
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
