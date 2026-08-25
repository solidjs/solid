const fs = require("fs");
const path = require("path");
const { transform } = require("../index");

const babelDomNoInlineStylesFixtures = path.resolve(
  __dirname,
  "../../babel-plugin-jsx/test/__dom_no_inline_styles_fixtures__"
);
const oxcDomNoInlineStylesFixtures = path.resolve(__dirname, "fixtures/dom-no-inline-styles");

const fixtureParity = {
  attributeExpressions: "subset"
};

function readFixture(name) {
  return fs.readFileSync(path.join(babelDomNoInlineStylesFixtures, name, "code.js"), "utf8");
}

function transformDomNoInlineStyles(code, fixture) {
  return (
    transform(code, {
      filename: `${fixture}.jsx`,
      moduleName: "r-dom",
      contextToCustomElements: true,
      inlineStyles: false
    }).code.trimEnd() + "\n"
  );
}

function outputFixturePath(fixture) {
  return path.join(oxcDomNoInlineStylesFixtures, fixture, "output.js");
}

function readOutputFixture(fixture) {
  return fs.readFileSync(outputFixturePath(fixture), "utf8");
}

function writeOutputFixture(fixture, output) {
  fs.mkdirSync(path.dirname(outputFixturePath(fixture)), { recursive: true });
  fs.writeFileSync(outputFixturePath(fixture), output);
}

describe("AST-native Babel DOM no-inline-styles fixture reuse", () => {
  it("classifies supported Babel DOM no-inline-styles fixtures", () => {
    const actual = fs
      .readdirSync(babelDomNoInlineStylesFixtures, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .filter(entry =>
        fs.existsSync(path.join(babelDomNoInlineStylesFixtures, entry.name, "code.js"))
      )
      .map(entry => entry.name)
      .sort();
    expect(Object.keys(fixtureParity).sort()).toEqual(actual);
  });

  it.each(Object.keys(fixtureParity))(
    "matches generated Oxc output for supported Babel DOM no-inline-styles fixture subset: %s",
    fixture => {
      const output = transformDomNoInlineStyles(supportedSubset(fixture), fixture);
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
