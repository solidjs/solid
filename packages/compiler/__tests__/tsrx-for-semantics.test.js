const { compileBabel, compileOxc, modes, normalize } = require("./parity/harness");

const source = `
export function Rows({ rows }) @{
  <ul>
    @for (const row of rows; index index) {
      <li>{index}: {row().name}</li>
    }
  </ul>
}
`;

const destructuredSource = `
export function Rows({ rows }) @{
  <ul>
    @for (const { name } of rows; index index) {
      <li>{index}: {name}</li>
    }
  </ul>
}
`;

describe("TSRX @for semantics", () => {
  const compilers = [
    ["Babel", () => compileBabel(source, modes["tsrx-dom"].options, "for-index.tsrx")],
    ["native", () => compileOxc(source, "for-index", modes["tsrx-dom"].options, ".tsrx")]
  ];

  test.each(compilers)(
    "%s emits non-keyed intent and passes the accessor item through as authored",
    (_, compile) => {
      const output = compile();

      expect(output).toContain("keyed: false");
      expect(output).toContain("index");
      expect(output).not.toContain("index()");
      expect(output).toContain("row().name");
      expect(output).not.toContain("row()()");
    }
  );

  // #3474: the item is an accessor here, so a destructuring pattern has
  // nothing to destructure. Both compilers reject it with the same message.
  test.each([
    ["Babel", () => compileBabel(destructuredSource, modes["tsrx-dom"].options, "for-index.tsrx")],
    [
      "native",
      () => compileOxc(destructuredSource, "for-index", modes["tsrx-dom"].options, ".tsrx")
    ]
  ])("%s rejects index-only destructuring", (_, compile) => {
    expect(compile).toThrow(
      "A destructured `@for` item binding is not supported together with `index` or `key`: Solid passes the item as an accessor. Bind a name and read it as a call (`item().name`) (4:16)"
    );
  });
});

// Keep the published parser's grammar: parenthesized key values are supported,
// while index bindings still use a bare identifier.
describe.each(["dom", "ssr", "universal"])("parenthesized @for keys (%s)", mode => {
  test.each([
    ["(item.id)", 3],
    ["(((item.id)))", 3],
    ["( /* before */ (item.id) /* after */ )", 3],
    ["((item.id + 1) * 2)", 8],
    ["(item.id, item.other)", 7],
    ["(item.id ? (item.other ?? 9) : 0)", 7]
  ])("preserves emitted code and key evaluation for key%s", (key, expected) => {
    const source = `export function F(items) @{ @for(const item of items; key${key}) { <div/> } }`;
    const options = modes[`tsrx-${mode}`].options;
    const babel = compileBabel(source, options, "parenthesized-key.tsrx");
    const native = compileOxc(source, "parenthesized-key", options, ".tsrx");
    expect(normalize(native)).toBe(normalize(babel));
    for (const output of [babel, native]) {
      expect(output).not.toMatch(/__tsrx/);
      // Execute the emitted key callback independently of renderer helpers.
      const core = require("@babel/core");
      const callbacks = [];
      core.transformSync(output, {
        configFile: false,
        babelrc: false,
        plugins: [
          () => ({
            visitor: {
              ObjectProperty(path) {
                if (path.node.key.name !== "keyed") return;
                const expression = core.transformFromAstSync(
                  core.types.file(
                    core.types.program([core.types.expressionStatement(path.node.value)])
                  ),
                  null,
                  { configFile: false, babelrc: false }
                ).code;
                callbacks.push(new Function(`return (${expression.replace(/;$/, "")});`)());
              }
            }
          })
        ]
      });
      expect(callbacks).toHaveLength(1);
      expect(callbacks[0]({ id: 3, other: 7 })).toBe(expected);
    }
  });
});

describe.each(["dom", "ssr", "universal"])("deep parenthesized control anchors (%s)", mode => {
  test.each([
    "@for(const item of (((items))); key item.id) { <div/> }",
    "@for(const item of (((items)))) { <div/> }",
    "@if ((((ready)))) { <div/> }",
    "@if ((/* outer */ ((ready)))) { <div/> }"
  ])("matches Babel for %s", control => {
    const source = `export function F(items, ready) @{ ${control} }`;
    const options = modes[`tsrx-${mode}`].options;
    expect(normalize(compileOxc(source, "deep-control", options, ".tsrx"))).toBe(
      normalize(compileBabel(source, options, "deep-control.tsrx"))
    );
  });
});
