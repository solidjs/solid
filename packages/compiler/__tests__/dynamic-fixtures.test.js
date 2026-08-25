const fs = require("fs");
const path = require("path");
const { transform } = require("../index");

const babelDynamicFixtures = path.resolve(
  __dirname,
  "../../babel-plugin-jsx/test/__dynamic_fixtures__"
);
const oxcDynamicFixtures = path.resolve(__dirname, "fixtures/dynamic");

const domElements = [
  "table",
  "tbody",
  "div",
  "h1",
  "span",
  "header",
  "footer",
  "slot",
  "my-el",
  "my-element",
  "module",
  "input",
  "img",
  "iframe",
  "button",
  "a",
  "svg",
  "rect",
  "x",
  "y",
  "linearGradient",
  "stop",
  "style",
  "li",
  "ul",
  "label",
  "text",
  "namespace:tag",
  "path",
  "noscript",
  "select",
  "option",
  "video"
];

const fixtureParity = {
  SVG: "subset",
  attributeExpressions: "subset",
  components: "subset",
  conditionalExpressions: "subset",
  customElements: "subset",
  eventExpressions: "subset",
  fragments: "subset",
  hybrid: "subset",
  insertChildren: "subset",
  namespaceElements: "subset",
  simpleElements: "subset",
  textInterpolation: "subset"
};

function readFixture(name) {
  return fs.readFileSync(path.join(babelDynamicFixtures, name, "code.js"), "utf8");
}

function transformDynamic(code, fixture) {
  return (
    transform(code, {
      filename: `${fixture}.jsx`,
      moduleName: "r-custom",
      generate: "dynamic",
      builtIns: ["For", "Show"],
      contextToCustomElements: true,
      renderers: [
        {
          name: "dom",
          moduleName: "r-dom",
          elements: domElements
        }
      ]
    }).code.trimEnd() + "\n"
  );
}

function outputFixturePath(fixture) {
  return path.join(oxcDynamicFixtures, fixture, "output.js");
}

function readOutputFixture(fixture) {
  return fs.readFileSync(outputFixturePath(fixture), "utf8");
}

function writeOutputFixture(fixture, output) {
  fs.mkdirSync(path.dirname(outputFixturePath(fixture)), { recursive: true });
  fs.writeFileSync(outputFixturePath(fixture), output);
}

describe("AST-native Babel dynamic fixture reuse", () => {
  it("classifies supported Babel dynamic fixtures", () => {
    expect(Object.keys(fixtureParity).sort()).toEqual([
      "SVG",
      "attributeExpressions",
      "components",
      "conditionalExpressions",
      "customElements",
      "eventExpressions",
      "fragments",
      "hybrid",
      "insertChildren",
      "namespaceElements",
      "simpleElements",
      "textInterpolation"
    ]);
  });

  it.each(Object.keys(fixtureParity))(
    "matches generated Oxc output for supported Babel dynamic fixture subset: %s",
    fixture => {
      const output = transformDynamic(readFixture(fixture), fixture);
      if (process.env.UPDATE_OXC_FIXTURES === "1") {
        writeOutputFixture(fixture, output);
      }
      expect(output).toBe(readOutputFixture(fixture));
    }
  );
});
