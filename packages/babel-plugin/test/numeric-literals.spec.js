const babel = require("@babel/core");
const plugin = require("../index");

// Evaluated numbers are rebuilt with `valueToNode`: Babel 8's `numericLiteral`
// rejects negative and non-finite values.
const source = `
const N = -1;
const a = <div prop:tabIndex={-1} prop:scrollTop={N} />;
const b = <div style={{ "z-index": -1, opacity: 0 / 0 }} />;
`;

describe("evaluated numeric literals", () => {
  test.each(["dom", "ssr", "universal"])("keep negative and non-finite values (%s)", generate => {
    const { code } = babel.transformSync(source, {
      plugins: [[plugin, { generate, moduleName: "r-dom" }]],
      configFile: false,
      babelrc: false,
      filename: "numeric.jsx"
    });
    if (generate === "dom") {
      expect(code).toContain("_el$.tabIndex = -1;");
      expect(code).toContain("_el$.scrollTop = -1;");
      expect(code).toContain("z-index:-1;opacity:NaN");
    } else if (generate === "ssr") {
      expect(code).toContain('"z-index:", -1');
    }
  });
});
