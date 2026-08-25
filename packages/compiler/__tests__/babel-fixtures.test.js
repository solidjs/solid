const fs = require("fs");
const path = require("path");
const { transform } = require("../index");

const babelDomFixtures = path.resolve(__dirname, "../../babel-plugin-jsx/test/__dom_fixtures__");
const oxcDomFixtures = path.resolve(__dirname, "fixtures/dom");

const parityLevel = {
  subset: "subset",
  knownUnsupported: "knownUnsupported"
};

const fixtureParity = {
  SVG: parityLevel.subset,
  SVGComponentPartial: parityLevel.subset,
  adjacentSlots: parityLevel.subset,
  attributeExpressions: parityLevel.subset,
  components: parityLevel.subset,
  conditionalExpressions: parityLevel.subset,
  customElements: parityLevel.subset,
  eventExpressions: parityLevel.subset,
  fragments: parityLevel.subset,
  insertChildren: parityLevel.subset,
  jsxAttributeValues: parityLevel.subset,
  keyedElements: parityLevel.subset,
  multipleClassAttributes: parityLevel.subset,
  namespaceElements: parityLevel.subset,
  simpleElements: parityLevel.subset,
  textInterpolation: parityLevel.subset
};

function fixtureNames(levels = null) {
  return Object.entries(fixtureParity)
    .filter(([, level]) => level !== parityLevel.knownUnsupported)
    .filter(([, level]) => !levels || levels.includes(level))
    .map(([fixture]) => fixture);
}

function readFixture(name) {
  return fs.readFileSync(path.join(babelDomFixtures, name, "code.js"), "utf8");
}

function transformDom(code, fixture) {
  return (
    transform(code, {
      filename: `${fixture}.jsx`,
      moduleName: "r-dom",
      contextToCustomElements: true,
      ...(fixture === "components" ? { builtIns: ["For", "Show"] } : null)
    }).code.trimEnd() + "\n"
  );
}

function outputFixturePath(fixture) {
  return path.join(oxcDomFixtures, fixture, "output.js");
}

function readOutputFixture(fixture) {
  return fs.readFileSync(outputFixturePath(fixture), "utf8");
}

function writeOutputFixture(fixture, output) {
  fs.mkdirSync(path.dirname(outputFixturePath(fixture)), { recursive: true });
  fs.writeFileSync(outputFixturePath(fixture), output);
}

function expectFixtureOutput(fixture) {
  const output = transformDom(supportedSubset(fixture), fixture);
  if (process.env.UPDATE_OXC_FIXTURES === "1") {
    writeOutputFixture(fixture, output);
  }
  expect(output).toBe(readOutputFixture(fixture));
}

function expectEveryDomFixtureClassified() {
  const actual = fs
    .readdirSync(babelDomFixtures, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .filter(entry => fs.existsSync(path.join(babelDomFixtures, entry.name, "code.js")))
    .map(entry => entry.name)
    .sort();
  expect(Object.keys(fixtureParity).sort()).toEqual(actual);
}

describe("AST-native Babel DOM fixture reuse", () => {
  it("classifies every Babel DOM fixture", () => {
    expectEveryDomFixtureClassified();
  });

  it.each(fixtureNames([parityLevel.subset]))(
    "matches generated Oxc output for supported Babel DOM fixture subset: %s",
    fixture => {
      expectFixtureOutput(fixture);
    }
  );

  it("tracks the supported simpleElements subset", () => {
    const code = supportedSubset("simpleElements");
    const output = transformDom(code, "simpleElements");

    expect(output).toBe(readOutputFixture("simpleElements"));
  });

  it("tracks the supported textInterpolation subset", () => {
    const code = supportedSubset("textInterpolation");
    const output = transformDom(code, "textInterpolation");

    expect(output).toBe(readOutputFixture("textInterpolation"));
  });

  it("tracks the supported components subset", () => {
    const output = transformDom(supportedSubset("components"), "components");

    expect(output).toBe(readOutputFixture("components"));
  });
});

function supportedSubset(fixture) {
  const source = readFixture(fixture);
  switch (fixture) {
    case "adjacentSlots":
      return source;
    case "jsxAttributeValues":
      return source;
    case "keyedElements":
      return source;
    case "simpleElements":
      return source;
    case "textInterpolation":
      return source;
    case "SVG":
      return source;
    case "SVGComponentPartial":
      return source;
    case "conditionalExpressions":
      return source;
    case "customElements":
      return source;
    case "fragments":
      return source;
    case "insertChildren":
      return source;
    case "multipleClassAttributes":
      return source;
    case "namespaceElements":
      return [
        source.slice(source.indexOf("const template ="), source.indexOf("const template4")),
        source.slice(source.indexOf("const template6"))
      ].join("\n");
    case "components":
      return source;
    case "eventExpressions":
      return source;
    case "attributeExpressions":
      return source;
    default:
      throw new Error(`No supported AST-native subset for ${fixture}`);
  }
}
