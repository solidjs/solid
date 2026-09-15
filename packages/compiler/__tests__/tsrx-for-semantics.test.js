const { compileBabel, compileOxc, modes } = require("./parity/harness");

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
