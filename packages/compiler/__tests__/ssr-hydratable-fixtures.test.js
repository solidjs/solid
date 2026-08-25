const fs = require("fs");
const path = require("path");
const { transform } = require("../index");

const babelSsrHydratableFixtures = path.resolve(
  __dirname,
  "../../babel-plugin-jsx/test/__ssr_hydratable_fixtures__"
);
const oxcSsrHydratableFixtures = path.resolve(__dirname, "fixtures/ssr-hydratable");

const fixtureParity = {
  SVG: "subset",
  attributeExpressions: "subset",
  components: "subset",
  conditionalExpressions: "subset",
  customElements: "subset",
  document: "subset",
  eventExpressions: "subset",
  flags: "subset",
  fragments: "subset",
  insertChildren: "subset",
  jsxAttributeValues: "subset",
  simpleElements: "subset",
  textInterpolation: "subset"
};

function readFixture(name) {
  return fs.readFileSync(path.join(babelSsrHydratableFixtures, name, "code.js"), "utf8");
}

function transformSsrHydratable(code, fixture) {
  return (
    transform(code, {
      filename: `${fixture}.jsx`,
      moduleName: "r-server",
      generate: "ssr",
      hydratable: true,
      contextToCustomElements: true,
      ...(fixture === "components" ? { builtIns: ["For", "Show"] } : null)
    }).code.trimEnd() + "\n"
  );
}

function outputFixturePath(fixture) {
  return path.join(oxcSsrHydratableFixtures, fixture, "output.js");
}

function readOutputFixture(fixture) {
  return fs.readFileSync(outputFixturePath(fixture), "utf8");
}

function writeOutputFixture(fixture, output) {
  fs.mkdirSync(path.dirname(outputFixturePath(fixture)), { recursive: true });
  fs.writeFileSync(outputFixturePath(fixture), output);
}

describe("AST-native Babel SSR hydratable fixture reuse", () => {
  it("classifies supported Babel SSR hydratable fixtures", () => {
    const actual = fs
      .readdirSync(babelSsrHydratableFixtures, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .filter(entry => fs.existsSync(path.join(babelSsrHydratableFixtures, entry.name, "code.js")))
      .map(entry => entry.name)
      .sort();
    expect(Object.keys(fixtureParity).sort()).toEqual(actual);
  });

  it.each(Object.keys(fixtureParity))(
    "matches generated Oxc output for supported Babel SSR hydratable fixture subset: %s",
    fixture => {
      const output = transformSsrHydratable(supportedSubset(fixture), fixture);
      if (process.env.UPDATE_OXC_FIXTURES === "1") {
        writeOutputFixture(fixture, output);
      }
      expect(output).toBe(readOutputFixture(fixture));
    }
  );
});

function supportedSubset(fixture) {
  return readFixture(fixture);
}
