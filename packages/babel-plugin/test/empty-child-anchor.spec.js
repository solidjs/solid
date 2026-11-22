const babel = require("@babel/core");
const plugin = require("../index");

const compile = source =>
  babel.transformSync(source, {
    plugins: [[plugin, { generate: "dom", moduleName: "r-dom" }]],
    configFile: false,
    babelrc: false,
    filename: "anchor.jsx"
  }).code;

describe("empty static children do not hide the insert anchor", () => {
  test.each([
    ["element", `const a = <div>{count()}{""}<span>s</span></div>;`],
    ["text", `const a = <div>{count()}{""}tail</div>;`],
    ["template literal", "const a = <div>{count()}{``}<span>s</span></div>;"],
    [
      "folded ternary",
      `const on = false; const a = <div>{count()}{on ? "x" : ""}<span>s</span></div>;`
    ],
    ["whitespace text", "const a = <div>{count()}  \n  <span>s</span></div>;"]
  ])("%s", (_, source) => {
    const code = compile(source);
    expect(code).toContain("_el$2 = _el$.firstChild");
    expect(code).toContain("_$insert(_el$, count, _el$2);");
  });
});
