const babel = require("@babel/core");
const plugin = require("../index");

// TSRX builds its Babel AST by hand, so it must match what the running
// @babel/core's own parser produces for plain TypeScript (Babel 7 and 8 differ:
// `typeArguments`, `ImportExpression`, type-parameter names, `TSEnumBody`, …).
const cases = [
  "function id<T extends object = {}>(value: T): T { return value; }",
  "const make = <T,>(v: T) => v;",
  "const n = make<number>(1);",
  'const m = obj?.make<string>("a");',
  "const k = new Map<string, number>();",
  "const tt = tag<string>`x`;",
  "const inst = make<number>;",
  'const lazy = () => import("./x");',
  'const lazyJson = () => import("./x", { with: { type: "json" } });',
  "type R = Record<string, Array<number>>;",
  "type Q = typeof make<number>;",
  'type I = import("./y").Z<string>;',
  "interface A<T> extends B<T>, C {}",
  "class D<T> extends E<T> implements F<T>, G { x: T; m<U>(u: U): U { return u; } }",
  "const cast = v as unknown as Map<string, number>;",
  "const sat = v satisfies Box<number>;",
  "enum Color { Red, Green }",
  "const el = <Comp<string> a={1} />;"
];

const DROP = new Set([
  "start",
  "end",
  "loc",
  "range",
  "extra",
  "comments",
  "leadingComments",
  "trailingComments",
  "innerComments"
]);

function normalize(node) {
  if (Array.isArray(node)) return node.map(normalize);
  if (!node || typeof node !== "object") return node;
  const out = {};
  for (const key of Object.keys(node).sort()) {
    // ESTree's boolean `expression` flag on arrows has no Babel meaning.
    if (DROP.has(key) || (key === "expression" && typeof node[key] === "boolean")) continue;
    const value = normalize(node[key]);
    if (value == null || value === false || (Array.isArray(value) && !value.length)) continue;
    out[key] = value;
  }
  return out;
}

const major = parseInt(babel.version, 10);
const tsrxParser = plugin({ version: babel.version }, {});

describe(`TSRX AST matches @babel/core ${major}`, () => {
  test.each(cases)("%s", code => {
    const expected = babel.parseSync(code, {
      configFile: false,
      babelrc: false,
      filename: "case.tsx",
      parserOpts: { plugins: ["typescript", "jsx"] }
    });
    const actual = tsrxParser.parserOverride(code, { sourceFileName: "case.tsrx" });
    expect(normalize(actual.program.body)).toEqual(normalize(expected.program.body));
  });

  test("type parameters and arguments survive a full transform", () => {
    const { code } = babel.transformSync(
      `function id<T>(value: T): T { return value; }
const n = make<number>(1);
export function App({ name }: { name: string }) @{
  <div title={id<string>(name)}>{n}</div>
}`,
      {
        plugins: [[plugin, { generate: "dom", moduleName: "r-dom" }]],
        configFile: false,
        babelrc: false,
        filename: "generics.tsrx"
      }
    );
    expect(code).toContain("function id<T>(value: T): T");
    expect(code).toContain("make<number>(1)");
    expect(code).toContain("id<string>(name)");
  });
});
