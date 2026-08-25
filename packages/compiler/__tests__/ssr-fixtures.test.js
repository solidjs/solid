const fs = require("fs");
const path = require("path");
const { transform } = require("../index");

const babelSsrFixtures = path.resolve(__dirname, "../../babel-plugin-jsx/test/__ssr_fixtures__");
const oxcSsrFixtures = path.resolve(__dirname, "fixtures/ssr");

const fixtureParity = {
  SVG: "subset",
  attributeExpressions: "subset",
  components: "subset",
  conditionalExpressions: "subset",
  customElements: "subset",
  duplicateAttributes: "subset",
  fragments: "subset",
  insertChildren: "subset",
  jsxAttributeValues: "subset",
  keyedElements: "subset",
  multipleClassAttributes: "subset",
  simpleElements: "subset",
  textInterpolation: "subset"
};

function readFixture(name) {
  return fs.readFileSync(path.join(babelSsrFixtures, name, "code.js"), "utf8");
}

function transformSsr(code, fixture) {
  return (
    transform(code, {
      filename: `${fixture}.jsx`,
      moduleName: "r-server",
      generate: "ssr",
      contextToCustomElements: true
    }).code.trimEnd() + "\n"
  );
}

function outputFixturePath(fixture) {
  return path.join(oxcSsrFixtures, fixture, "output.js");
}

function readOutputFixture(fixture) {
  return fs.readFileSync(outputFixturePath(fixture), "utf8");
}

function writeOutputFixture(fixture, output) {
  fs.mkdirSync(path.dirname(outputFixturePath(fixture)), { recursive: true });
  fs.writeFileSync(outputFixturePath(fixture), output);
}

describe("AST-native Babel SSR fixture reuse", () => {
  it("classifies supported Babel SSR fixtures", () => {
    expect(Object.keys(fixtureParity).sort()).toEqual([
      "SVG",
      "attributeExpressions",
      "components",
      "conditionalExpressions",
      "customElements",
      "duplicateAttributes",
      "fragments",
      "insertChildren",
      "jsxAttributeValues",
      "keyedElements",
      "multipleClassAttributes",
      "simpleElements",
      "textInterpolation"
    ]);
  });

  it.each(Object.keys(fixtureParity))(
    "matches generated Oxc output for supported Babel SSR fixture subset: %s",
    fixture => {
      const output = transformSsr(supportedSubset(fixture), fixture);
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
    case "keyedElements":
      return source;
    case "SVG":
      return source;
    case "attributeExpressions":
      return source;
    case "components":
      return source;
    case "conditionalExpressions":
      return source;
    case "customElements":
      return source;
    case "duplicateAttributes":
      return source;
    case "fragments":
      return source;
    case "insertChildren":
      return source;
    case "multipleClassAttributes":
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
        ),
        source.slice(source.indexOf("const lastElementExpression"))
      ].join("\n");
    default:
      throw new Error(`No supported SSR subset for ${fixture}`);
  }
}
