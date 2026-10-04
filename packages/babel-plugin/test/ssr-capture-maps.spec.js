const babel = require("@babel/core");
const { createRequire } = require("module");
const { TraceMap, originalPositionFor } = createRequire(require.resolve("@babel/core"))(
  "@jridgewell/trace-mapping"
);
const plugin = require("../index");

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

function assertCaptures(source, filename, dev, expected) {
  const result = compile(source, filename, dev);
  const map = new TraceMap(result.map);
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
  visit(babel.parseSync(result.code, { configFile: false, babelrc: false }));
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
      const position = originalPositionFor(map, arg.loc.start);
      expect(position).toMatchObject({
        source: filename,
        line: prefix.length,
        column: prefix.at(-1).length
      });
    });
  });
}

describe("SSR capture source maps", () => {
  for (const dev of [false, true]) {
    for (const comment of ["/* capture-comment */", "// capture-comment\n"]) {
      test(`keeps capture comments at the authored reference (dev: ${dev}, ${comment.trim()})`, () => {
        const source = `function F(Comp) {
  const a = () => 1;
  return <Comp value={a ${comment} ()} />;
}`;
        const result = compile(source, "comments.jsx", dev);
        expect(result.code.match(/capture-comment/g)).toHaveLength(1);
        assertCaptures(source, "comments.jsx", dev, [[["a", "a " + comment]]]);
      });
    }

    test(`dynamic TSRX capture points to column 21 (dev: ${dev})`, () => {
      const source = `const label = "café 🚀";
export function F(Tag) @{
  const a = () => label;
  <{Tag} data-value={a()}/>
}`;
      expect(source.split("\n")[3].indexOf("a()")).toBe(21);
      assertCaptures(source, "capture.tsrx", dev, [
        [
          ["a", "a()"],
          ["Tag", "Tag}"]
        ]
      ]);
    });

    test(`Unicode on the same line and repeated getters/ref (dev: ${dev})`, () => {
      const source = `const label = "café 🚀";
export function F(Tag) @{
  const a = () => label;
  const b = el => el;
  <{Tag} title="café 🚀" data-value={a()} other={a()} ref={b}/>
}`;
      assertCaptures(source, "unicode.tsrx", dev, [
        [
          ["a", "a()"],
          ["b", "b}/"],
          ["Tag", "Tag}"]
        ]
      ]);
    });

    test(`captures follow bindings across nested shadowing (dev: ${dev})`, () => {
      const source = `const globalValue = () => "global";
function Outer(Comp) {
  const a = () => "outer";
  function Inner() {
    const a = () => "inner";
    return <Comp value={a()} other={globalValue()} />;
  }
  return [<Comp value={a()} />, Inner()];
}`;
      assertCaptures(source, "shadow.jsx", dev, [[["a", "a()} other"]], [["a", "a()} />"]]]);
    });
  }
});
