const { compileBabel, compileOxc, modes } = require("./parity/harness");

const source = `
export function Rows({ rows }) @{
  <ul>
    @for (const row of rows; index index) {
      <li>{index}: {row.name}</li>
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
    "%s uses non-keyed callback types when an index has no key",
    (_, compile) => {
      const output = compile();

      expect(output).toContain("keyed: false");
      expect(output).toContain("index");
      expect(output).not.toContain("index()");
      expect(output).toContain("row().name");
    }
  );

  test.each([
    ["Babel", () => compileBabel(destructuredSource, modes["tsrx-dom"].options, "for-index.tsrx")],
    [
      "native",
      () => compileOxc(destructuredSource, "for-index", modes["tsrx-dom"].options, ".tsrx")
    ]
  ])("%s keeps index-only destructuring lazy", (_, compile) => {
    const output = compile();

    expect(output).toContain("keyed: false");
    expect(output).not.toContain("index()");
    expect(output).toMatch(/__lazy\d+\(\)\.name/);
  });
});
