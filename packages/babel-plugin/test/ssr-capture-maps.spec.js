const babel = require("@babel/core");
const plugin = require("../index");
const { cases, assertCaptures } = require("./__shared_fixtures__/ssrCaptureMaps/expected");

function compile(source, filename, dev) {
  return babel.transformSync(source, {
    filename,
    configFile: false,
    babelrc: false,
    sourceMaps: true,
    plugins: [
      [plugin, { generate: "ssr", moduleName: "r-server", requireImportSource: false, dev }]
    ]
  });
}

describe("SSR capture source maps", () => {
  for (const dev of [false, true]) {
    for (const testCase of cases) {
      test(`${testCase.name} (dev: ${dev})`, () => {
        const result = compile(testCase.source, testCase.filename, dev);
        if (testCase.comment) {
          expect(result.code.match(new RegExp(testCase.comment, "g"))).toHaveLength(1);
        }
        assertCaptures(testCase, result.code, result.map);
      });
    }
  }
});
