const fs = require("fs");
const path = require("path");
const { transform } = require("../index");

const babelDomHydratableFixtures = path.resolve(
  __dirname,
  "../../babel-plugin-jsx/test/__dom_hydratable_fixtures__"
);
const oxcDomHydratableFixtures = path.resolve(__dirname, "fixtures/dom-hydratable");

const fixtureParity = {
  SVG: "subset",
  SVGComponentPartial: "subset",
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
  keyedElements: "subset",
  simpleElements: "subset",
  textInterpolation: "subset"
};

function readFixture(name) {
  return fs.readFileSync(path.join(babelDomHydratableFixtures, name, "code.js"), "utf8");
}

function transformDomHydratable(code, fixture) {
  return (
    transform(code, {
      filename: `${fixture}.jsx`,
      moduleName: "r-dom",
      hydratable: true,
      contextToCustomElements: true,
      ...(fixture === "components" ? { builtIns: ["For", "Show"] } : null)
    }).code.trimEnd() + "\n"
  );
}

function outputFixturePath(fixture) {
  return path.join(oxcDomHydratableFixtures, fixture, "output.js");
}

function readOutputFixture(fixture) {
  return fs.readFileSync(outputFixturePath(fixture), "utf8");
}

function writeOutputFixture(fixture, output) {
  fs.mkdirSync(path.dirname(outputFixturePath(fixture)), { recursive: true });
  fs.writeFileSync(outputFixturePath(fixture), output);
}

describe("AST-native Babel DOM hydratable fixture reuse", () => {
  it("classifies supported Babel DOM hydratable fixtures", () => {
    const actual = fs
      .readdirSync(babelDomHydratableFixtures, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .filter(entry => fs.existsSync(path.join(babelDomHydratableFixtures, entry.name, "code.js")))
      .map(entry => entry.name)
      .sort();
    expect(Object.keys(fixtureParity).sort()).toEqual(actual);
  });

  it.each(Object.keys(fixtureParity))(
    "matches generated Oxc output for supported Babel DOM hydratable fixture subset: %s",
    fixture => {
      const output = transformDomHydratable(supportedSubset(fixture), fixture);
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
