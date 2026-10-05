const path = require("path");
const { transform } = require("../index");
const { cases, assertCaptures } = require(
  path.resolve(__dirname, "../../babel-plugin/test/__shared_fixtures__/ssrCaptureMaps/expected")
);

// Known divergence: a dynamic TSRX tag lowers to a `Dynamic` site whose span
// the TSRX route clears, so the props pass cannot order its captures against
// their declarations and keeps the literal. Babel hoists it.
const unhoisted = new Set([
  "dynamic TSRX capture points to column 21",
  "Unicode on the same line and repeated getters/ref"
]);

function compile(source, filename, dev) {
  return transform(source, {
    filename,
    generate: "ssr",
    moduleName: "r-server",
    requireImportSource: false,
    dev,
    sourceMap: true
  });
}

describe("SSR capture source maps", () => {
  for (const dev of [false, true]) {
    for (const testCase of cases) {
      test(`${testCase.name} (dev: ${dev})`, () => {
        const result = compile(testCase.source, testCase.filename, dev);
        // Oxc's codegen drops a comment between a callee and its call
        // parentheses wherever it appears; hoisting must not duplicate it.
        if (testCase.comment) {
          expect(
            (result.code.match(new RegExp(testCase.comment, "g")) || []).length
          ).toBeLessThanOrEqual(1);
        }
        if (unhoisted.has(testCase.name)) {
          expect(result.code).not.toMatch(/new _P\$/);
          return;
        }
        assertCaptures(testCase, result.code, result.map);
      });
    }

    // Codegen anchors a comment to the position of the token after it and
    // prints it at the first node starting there; an argument mapped to that
    // reference would pull it out of the getter, so the argument stays unmapped.
    test(`a comment before the first reference stays out of the constructor call (dev: ${dev})`, () => {
      const source = `function F(Comp) {
  const a = () => 1;
  return <Comp value={/* lead */ a()} />;
}`;
      const { code } = compile(source, "lead.jsx", dev);
      expect(code).toMatch(/new _P\$\(a\)/);
      expect(code).not.toMatch(/new _P\$\([^)]*lead/);
    });
  }
});
