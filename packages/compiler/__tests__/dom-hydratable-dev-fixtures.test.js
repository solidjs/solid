const fs = require("fs");
const path = require("path");
const { transform } = require("../index");

const babelDomHydratableDevFixtures = path.resolve(
  __dirname,
  "../../babel-plugin-jsx/test/__dom_hydratable_dev_fixtures__"
);
const oxcDomHydratableDevFixtures = path.resolve(__dirname, "fixtures/dom-hydratable-dev");

const fixtureParity = {
  simpleElements: "subset",
  walkValidation: "subset"
};

function readFixture(name) {
  return fs.readFileSync(path.join(babelDomHydratableDevFixtures, name, "code.js"), "utf8");
}

function transformDomHydratableDev(code, fixture) {
  return (
    transform(code, {
      filename: `${fixture}.jsx`,
      moduleName: "r-dom",
      hydratable: true,
      dev: true,
      contextToCustomElements: true,
      ...(fixture === "components" ? { builtIns: ["For", "Show"] } : null)
    }).code.trimEnd() + "\n"
  );
}

function outputFixturePath(fixture) {
  return path.join(oxcDomHydratableDevFixtures, fixture, "output.js");
}

function readOutputFixture(fixture) {
  return fs.readFileSync(outputFixturePath(fixture), "utf8");
}

function writeOutputFixture(fixture, output) {
  fs.mkdirSync(path.dirname(outputFixturePath(fixture)), { recursive: true });
  fs.writeFileSync(outputFixturePath(fixture), output);
}

describe("AST-native Babel DOM hydratable dev fixture reuse", () => {
  it("classifies supported Babel DOM hydratable dev fixtures", () => {
    const actual = fs
      .readdirSync(babelDomHydratableDevFixtures, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .filter(entry =>
        fs.existsSync(path.join(babelDomHydratableDevFixtures, entry.name, "code.js"))
      )
      .map(entry => entry.name)
      .sort();
    expect(Object.keys(fixtureParity).sort()).toEqual(actual);
  });

  it.each(Object.keys(fixtureParity))(
    "matches generated Oxc output for supported Babel DOM hydratable dev fixture subset: %s",
    fixture => {
      const output = transformDomHydratableDev(supportedSubset(fixture), fixture);
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
