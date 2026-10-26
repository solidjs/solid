const babel = require("@babel/core");
const plugin = require("../index");

// `import()` parses as `ImportExpression` on Babel 8 (and on 7 with
// `createImportExpressions`); it must stay dynamic like any call.
const source = `
const a = <Show>{import("./x")}</Show>;
const b = <div>{import("./y")}</div>;
const c = <div title={cond ? import("./z") : null} />;
`;

function compile(generate, parserOpts) {
  return babel.transformSync(source, {
    plugins: [[plugin, { generate, moduleName: "r-dom" }]],
    parserOpts,
    configFile: false,
    babelrc: false,
    filename: "imports.jsx"
  }).code;
}

describe("import() expressions", () => {
  for (const generate of ["dom", "ssr", "universal"]) {
    test(`are dynamic (${generate})`, () => {
      const code = compile(generate, { createImportExpressions: true });
      expect(code).toContain('return import("./x");');
      if (generate === "ssr") {
        expect(code).toContain('() => _$escape(import("./y"))');
      } else {
        expect(code).toContain('_$insert(_el$, () => import("./y"));');
        expect(code).toMatch(/_\$effect\(\(\) => cond \? import\("\.\/z"\) : null/);
      }
    });

    test(`compile the same either way they parse (${generate})`, () => {
      expect(compile(generate, { createImportExpressions: true })).toBe(
        compile(generate, { createImportExpressions: false })
      );
    });
  }
});
