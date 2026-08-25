const fs = require("fs");
const path = require("path");
const { transform } = require("../index");

const babelUniversalFixtures = path.resolve(
  __dirname,
  "../../babel-plugin-jsx/test/__universal_fixtures__"
);
const oxcDynamicUniversalFixtures = path.resolve(__dirname, "fixtures/dynamic-universal");

const fixtureParity = {
  attributeExpressions: "subset",
  components: "subset",
  conditionalExpressions: "subset",
  fragments: "subset",
  insertChildren: "subset",
  jsxAttributeValues: "subset",
  simpleElements: "subset",
  textInterpolation: "subset"
};

function readFixture(name) {
  return fs.readFileSync(path.join(babelUniversalFixtures, name, "code.js"), "utf8");
}

function transformDynamicUniversal(code, fixture) {
  return (
    transform(code, {
      filename: `${fixture}.jsx`,
      moduleName: "r-custom",
      generate: "dynamic",
      builtIns: ["For", "Show"]
    }).code.trimEnd() + "\n"
  );
}

function outputFixturePath(fixture) {
  return path.join(oxcDynamicUniversalFixtures, fixture, "output.js");
}

function readOutputFixture(fixture) {
  return fs.readFileSync(outputFixturePath(fixture), "utf8");
}

function writeOutputFixture(fixture, output) {
  fs.mkdirSync(path.dirname(outputFixturePath(fixture)), { recursive: true });
  fs.writeFileSync(outputFixturePath(fixture), output);
}

describe("AST-native Babel dynamic-universal fixture reuse", () => {
  it("classifies supported Babel dynamic-universal fixtures", () => {
    expect(Object.keys(fixtureParity).sort()).toEqual([
      "attributeExpressions",
      "components",
      "conditionalExpressions",
      "fragments",
      "insertChildren",
      "jsxAttributeValues",
      "simpleElements",
      "textInterpolation"
    ]);
  });

  it.each(Object.keys(fixtureParity))(
    "matches generated Oxc output for supported Babel dynamic-universal fixture subset: %s",
    fixture => {
      const output = transformDynamicUniversal(readFixture(fixture), fixture);
      if (process.env.UPDATE_OXC_FIXTURES === "1") {
        writeOutputFixture(fixture, output);
      }
      expect(output).toBe(readOutputFixture(fixture));
    }
  );
});
