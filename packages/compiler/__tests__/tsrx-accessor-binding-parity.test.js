const { compileBabel, compileOxc, normalize } = require("./parity/harness");

const options = {
  moduleName: "@solidjs/web",
  builtIns: ["For", "Show", "Switch", "Match", "Errored", "Loading", "Dynamic"],
  generate: "dom",
  wrapConditionals: true,
  contextToCustomElements: true,
  requireImportSource: false
};

function compare(source) {
  const babel = compileBabel(source, options, "accessor-parity.tsrx");
  const oxc = compileOxc(source, "accessor-parity", options, ".tsrx");
  expect(normalize(oxc)).toBe(normalize(babel));
  return babel;
}

function thrownMessage(compile) {
  try {
    compile();
  } catch (error) {
    return error.message;
  }
  throw new Error("expected the compile to throw");
}

// #3474: `@for … index/key` items and `@catch` errors pass through to `For` /
// `Errored` as the accessors Solid hands out. Neither frontend rewrites reads,
// so what the author writes is what runs — and both frontends agree byte for
// byte, including on the diagnostic for a destructured accessor.
describe("native TSRX accessor binding parity", () => {
  test("matches every For callback mode with identifier bindings", () => {
    const output = compare(`
      export function View({ rows }) @{
        <ul>
          @for (const plain of rows) { <li>{plain.name}</li> }
          @for (const indexed of rows; index i) { <li>{i}: {indexed().name}</li> }
          @for (const keyed of rows; key keyed.id) { <li>{keyed().name}</li> }
          @for (const both of rows; index j; key both.id) {
            const snapshot = both;
            <li data-id={snapshot().id}>{j()}: {both().name}</li>
          }
        </ul>
      }
    `);
    expect(output).toContain("plain.name");
    expect(output).toContain("indexed().name");
    expect(output).toContain("keyed().name");
    expect(output).toContain("both().name");
    expect(output).not.toContain("plain().name");
    expect(output).not.toContain("()()");
    expect(output).not.toContain("__lazy");
  });

  test("matches catch bindings with reset", () => {
    const output = compare(`
      export function View() @{
        @try {
          <Broken />
        } @catch (err, reset) {
          <button onClick={reset}>{err().message}: {String(err())}</button>
        }
      }
    `);
    expect(output).toContain("err().message");
    expect(output).toContain("String(err())");
    expect(output).not.toContain("err()()");
  });

  test.each([
    [
      "index-only @for item",
      `export function View({ rows }) @{\n  <ul>\n    @for (const { id, label = id, ...rest } of rows; index i) {\n      <li>{label}</li>\n    }\n  </ul>\n}`
    ],
    [
      "custom-key @for item",
      `export function View({ rows }) @{\n  <ul>\n    @for (const [first] of rows; key first) {\n      <li>{first}</li>\n    }\n  </ul>\n}`
    ],
    [
      "@catch error binding",
      `export function View() @{\n  @try {\n    <Broken />\n  } @catch ({ message = "fallback", ...details }, reset) {\n    <button onClick={reset}>{message}</button>\n  }\n}`
    ]
  ])("both frontends reject a destructured %s with the same diagnostic", (_, source) => {
    const babel = thrownMessage(() => compileBabel(source, options, "reject.tsrx"));
    const oxc = thrownMessage(() => compileOxc(source, "reject", options, ".tsrx"));
    expect(babel).toMatch(/^A destructured `@(for|catch)` /);
    expect(oxc).toBe(babel);
  });
});
