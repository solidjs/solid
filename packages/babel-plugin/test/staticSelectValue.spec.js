const babel = require("@babel/core");
const plugin = require("../index");

function compile(code) {
  return babel.transformSync(code, {
    babelrc: false,
    configFile: false,
    filename: "input.jsx",
    plugins: [[plugin, { moduleName: "r-dom", generate: "dom" }]]
  }).code;
}

test("assigns static select values through the DOM property", () => {
  const code = compile(`
    const stringAttribute = <select value="2"><option value="2">Two</option></select>;
    const stringExpression = <select value={"2"}><option value="2">Two</option></select>;
    const numberExpression = <select value={2}><option value="2">Two</option></select>;
    const multipleString = <select multiple value="2"><option value="2">Two</option></select>;
    const multipleArray = <select multiple value={["1", "2"]}><option value="2">Two</option></select>;
    const dynamicChildren = <select value="2">{options()}</select>;
  `);

  expect(code).not.toMatch(/_\$template\(`<select value=/);
  expect(code).not.toMatch(/queueMicrotask/);
  expect(code.match(/_\$setProperty\(/g)).toHaveLength(6);
  expect(code).toMatch(/_\$setProperty\([^)]*"value", \["1", "2"\]\)/);
  expect(code.indexOf("_$setProperty")).toBeLessThan(code.indexOf("_$insert("));
});
