const path = require("path");
const { transform } = require("../index");
const { cases, assertCase } = require(
  path.resolve(__dirname, "../../babel-plugin/test/__shared_fixtures__/ssrHoistPropsTypes/expected")
);

function compile(source, filename, hoistProps) {
  return transform(source, {
    filename,
    generate: "ssr",
    moduleName: "r-server",
    requireImportSource: false,
    hoistProps
  }).code;
}

describe("SSR hoisted props skip TypeScript type positions", () => {
  for (const testCase of cases) {
    test(testCase.name, () => assertCase(testCase, compile));
  }
});
