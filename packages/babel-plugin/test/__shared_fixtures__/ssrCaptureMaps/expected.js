// Shared by the Babel plugin and native compiler tests: every SSR props
// constructor call `new _P$(…)` must map each captured binding argument back
// to the binding's first authored reference.
const babel = require("@babel/core");
const { createRequire } = require("module");
const { TraceMap, originalPositionFor } = createRequire(require.resolve("@babel/core"))(
  "@jridgewell/trace-mapping"
);

const cases = [];

for (const comment of ["/* capture-comment */", "// capture-comment\n"]) {
  cases.push({
    name: `keeps capture comments at the authored reference (${comment.trim()})`,
    filename: "comments.jsx",
    comment: "capture-comment",
    source: `function F(Comp) {
  const a = () => 1;
  return <Comp value={a ${comment} ()} />;
}`,
    captures: [[["a", "a " + comment]]]
  });
}

cases.push({
  name: "dynamic TSRX capture points to column 21",
  filename: "capture.tsrx",
  source: `const label = "café 🚀";
export function F(Tag) @{
  const a = () => label;
  <{Tag} data-value={a()}/>
}`,
  column: [3, "a()", 21],
  captures: [
    [
      ["a", "a()"],
      ["Tag", "Tag}"]
    ]
  ]
});

cases.push({
  name: "Unicode on the same line and repeated getters/ref",
  filename: "unicode.tsrx",
  source: `const label = "café 🚀";
export function F(Tag) @{
  const a = () => label;
  const b = el => el;
  <{Tag} title="café 🚀" data-value={a()} other={a()} ref={b}/>
}`,
  captures: [
    [
      ["a", "a()"],
      ["b", "b}/"],
      ["Tag", "Tag}"]
    ]
  ]
});

cases.push({
  name: "TSRX component capture with Unicode before it",
  filename: "component.tsrx",
  source: `const label = "café 🚀";
export function F(Comp) @{
  const a = () => label;
  const b = el => el;
  <Comp title="café 🚀" data-value={a()} ref={b}/>
}`,
  captures: [
    [
      ["a", "a()"],
      ["b", "b}/"]
    ]
  ]
});

cases.push({
  name: "captures follow bindings across nested shadowing",
  filename: "shadow.jsx",
  source: `const globalValue = () => "global";
function Outer(Comp) {
  const a = () => "outer";
  function Inner() {
    const a = () => "inner";
    return <Comp value={a()} other={globalValue()} />;
  }
  return [<Comp value={a()} />, Inner()];
}`,
  captures: [[["a", "a()} other"]], [["a", "a()} />"]]]
});

exports.cases = cases;

// `code` and `map` are one compiler's SSR output for `testCase.source`.
exports.assertCaptures = function assertCaptures(testCase, code, map) {
  const { source, filename, captures: expected } = testCase;
  if (testCase.column) {
    const [line, marker, column] = testCase.column;
    expect(source.split("\n")[line].indexOf(marker)).toBe(column);
  }
  const trace = new TraceMap(map);
  const constructors = [];
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "NewExpression" && /^_P\$/.test(node.callee.name)) constructors.push(node);
    for (const key of babel.types.VISITOR_KEYS[node.type] || []) {
      const child = node[key];
      if (Array.isArray(child)) child.forEach(visit);
      else visit(child);
    }
  }
  visit(babel.parseSync(code, { configFile: false, babelrc: false }));
  expect(constructors).toHaveLength(expected.length);
  constructors.forEach((node, site) => {
    expect(
      node.arguments
        .filter(arg => arg.type === "Identifier")
        .map(arg => arg.name)
        .sort()
    ).toEqual(expected[site].map(([name]) => name).sort());
    expected[site].forEach(([name, authored]) => {
      const arg = node.arguments.find(arg => arg.type === "Identifier" && arg.name === name);
      expect(arg).toBeDefined();
      const offset = source.indexOf(authored);
      expect(offset).toBeGreaterThanOrEqual(0);
      const prefix = source.slice(0, offset).split("\n");
      const position = originalPositionFor(trace, arg.loc.start);
      expect(position).toMatchObject({
        source: filename,
        line: prefix.length,
        column: prefix.at(-1).length
      });
    });
  });
};
