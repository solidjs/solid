const fs = require("fs");
const path = require("path");
const { transform } = require("../index");

const babelUniversalFixtures = path.resolve(
  __dirname,
  "../../babel-plugin-jsx/test/__universal_fixtures__"
);
const oxcUniversalFixtures = path.resolve(__dirname, "fixtures/universal");

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

function transformUniversal(code, fixture) {
  return (
    transform(code, {
      filename: `${fixture}.jsx`,
      moduleName: "r-custom",
      generate: "universal"
    }).code.trimEnd() + "\n"
  );
}

function outputFixturePath(fixture) {
  return path.join(oxcUniversalFixtures, fixture, "output.js");
}

function readOutputFixture(fixture) {
  return fs.readFileSync(outputFixturePath(fixture), "utf8");
}

function writeOutputFixture(fixture, output) {
  fs.mkdirSync(path.dirname(outputFixturePath(fixture)), { recursive: true });
  fs.writeFileSync(outputFixturePath(fixture), output);
}

describe("AST-native Babel universal fixture reuse", () => {
  it("classifies supported Babel universal fixtures", () => {
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
    "matches generated Oxc output for supported Babel universal fixture subset: %s",
    fixture => {
      const output = transformUniversal(supportedSubset(fixture), fixture);
      if (process.env.UPDATE_OXC_FIXTURES === "1") {
        writeOutputFixture(fixture, output);
      }
      expect(output).toBe(readOutputFixture(fixture));
    }
  );
});

function supportedSubset(fixture) {
  const source = readFixture(fixture);
  switch (fixture) {
    case "simpleElements":
      return source;
    case "jsxAttributeValues":
      return source;
    case "attributeExpressions":
      return source;
    case "components":
      return source;
    case "conditionalExpressions":
      return source;
    case "fragments":
      return source;
    case "insertChildren":
      return source;
    case "textInterpolation":
      return [
        source.slice(0, source.indexOf("const escape2")),
        source.slice(source.indexOf("const injection"), source.indexOf("const trailingSpaceComp")),
        source.slice(
          source.indexOf("const leadingSpaceElement"),
          source.indexOf("const leadingSpaceComponent")
        ),
        source.slice(
          source.indexOf("const trailingSpaceElement"),
          source.indexOf("const trailingSpaceComponent")
        ),
        source.slice(
          source.indexOf("const escapeAttribute"),
          source.indexOf("const escapeCompAttribute")
        )
      ].join("\n");
    default:
      throw new Error(`No supported universal subset for ${fixture}`);
  }
}
