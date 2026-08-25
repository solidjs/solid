const fs = require("fs");
const path = require("path");
const { transform } = require("../index");

const babelDomWrapperlessFixtures = path.resolve(
  __dirname,
  "../../babel-plugin/test/__dom_wrapperless_fixtures__"
);
const oxcDomWrapperlessFixtures = path.resolve(__dirname, "fixtures/dom-wrapperless");

const fixtureParity = {
  components: "subset",
  conditionalExpressions: "subset",
  fragments: "subset"
};

function readFixture(name) {
  return fs.readFileSync(path.join(babelDomWrapperlessFixtures, name, "code.js"), "utf8");
}

function transformDomWrapperless(code, fixture) {
  return (
    transform(code, {
      filename: `${fixture}.jsx`,
      moduleName: "r-dom",
      builtIns: ["For", "Show"],
      wrapConditionals: false,
      delegateEvents: false,
      effectWrapper: false,
      memoWrapper: false,
      contextToCustomElements: true
    }).code.trimEnd() + "\n"
  );
}

function outputFixturePath(fixture) {
  return path.join(oxcDomWrapperlessFixtures, fixture, "output.js");
}

function readOutputFixture(fixture) {
  return fs.readFileSync(outputFixturePath(fixture), "utf8");
}

function writeOutputFixture(fixture, output) {
  fs.mkdirSync(path.dirname(outputFixturePath(fixture)), { recursive: true });
  fs.writeFileSync(outputFixturePath(fixture), output);
}

describe("AST-native Babel DOM wrapperless fixture reuse", () => {
  it("classifies supported Babel DOM wrapperless fixtures", () => {
    const actual = fs
      .readdirSync(babelDomWrapperlessFixtures, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .filter(entry => fs.existsSync(path.join(babelDomWrapperlessFixtures, entry.name, "code.js")))
      .map(entry => entry.name)
      .sort();
    expect(Object.keys(fixtureParity).sort()).toEqual(actual);
  });

  it.each(Object.keys(fixtureParity))(
    "matches generated Oxc output for supported Babel DOM wrapperless fixture subset: %s",
    fixture => {
      const output = transformDomWrapperless(supportedSubset(fixture), fixture);
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
