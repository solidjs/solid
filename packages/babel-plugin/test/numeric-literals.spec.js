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

describe("evaluated numeric attributes stay static", () => {
  const attrs = `const a = <div c={-1} d={0 / 0} e={-0} />;
const b = <input prop:value={-1} />;`;
  const compile = generate =>
    babel.transformSync(attrs, {
      plugins: [[plugin, { generate, moduleName: "r-dom" }]],
      configFile: false,
      babelrc: false,
      filename: "numeric.jsx"
    }).code;

  test("dom", () => {
    const code = compile("dom");
    expect(code).toContain("<div c=-1 d=NaN e=0>");
    expect(code).toContain("_el$2.value = -1;");
  });

  test("ssr", () => {
    expect(compile("ssr")).toContain('c=\\"-1\\" d=\\"NaN\\" e=\\"0\\"');
  });

  test("universal", () => {
    const code = compile("universal");
    expect(code).toContain("c: -1");
    expect(code).toContain("d: NaN");
    expect(code).toContain("e: -0");
  });
});
