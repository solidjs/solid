const babel = require("@babel/core");
const { compileBabel, compileOxc, modes } = require("./parity/harness");

function assertValid(code) {
  expect(() => babel.parseSync(code, { babelrc: false, configFile: false })).not.toThrow();
  expect(code).not.toMatch(/_t\d+_(?:R|K|I|H)\d/);
}

describe.each(["dom", "ssr", "universal"])("TSRX authored comments (%s)", mode => {
  const options = { ...modes[`tsrx-${mode}`].options, sourceMap: true };
  test("emits valid JavaScript across projected comment offsets", () => {
    for (let width = 0; width <= 32; width++) {
      const key = `item.id + "${"a".repeat(width)}"`;
      const sources = [
        `export function F(items, ready) @{ @for(const item of items; key(${key})) { <div/> } }`,
        `export function F(items, ready) @{ @for(const item of items; key ${key}) { <div/> } }`,
        `const v = @for(const item of items; key ${key}) { <div/> };`,
        `const v = @for(const item of items; key(${key})) { <div/> };`,
        `const v = @for(const item of items; index i; key ${key}) { <div>{i()}</div> };`,
        `export function F(items) @{ <ul>@for(const item of items; key ${key}) { <li/> }</ul> }`,
        `export function F(ready) @{ @if (ready === "${"a".repeat(width)}") { <div/> } }`,
        `const v = @switch (value) { @case "${"a".repeat(width)}": { <div/> } @default: { <span/> } };`
      ];
      for (const source of sources) assertValid(compileOxc(source, "comments", options, ".tsrx"));
    }
  });

  test("emits a valid conditional key after LF", () => {
    const source =
      "export function F(items) @{ @for(const item of items;\nkey(item.active ? item.id : item.other)) { <div/> } }";
    assertValid(compileBabel(source, options, "comments.tsrx"));
    assertValid(compileOxc(source, "comments", options, ".tsrx"));
  });

  test("preserves authored comments and annotations after projection", () => {
    const source = `
      /*! authored license */
      export function F(items) @{
        // authored setup
        const local = /* @__PURE__ */ factory();
        @for(const item of items; key(/* authored key */ item.id)) { <div>{local}</div> }
      }
      /* @__NO_SIDE_EFFECTS__ */
      function helper() { return 1; }
      // authored tail
      export const result = /* #__PURE__ */ helper();
    `;
    const output = compileOxc(source, "comments", options, ".tsrx");
    assertValid(output);
    for (const comment of [
      "authored license",
      "authored setup",
      "authored tail",
      "@__NO_SIDE_EFFECTS__",
      "#__PURE__"
    ]) {
      expect(output).toContain(comment);
    }
    // Babel also drops the key comment; it must not leak authored source instead.
    expect(output).not.toMatch(/item\.id\)\) \{/);
    expect(output).toMatch(/@__PURE__[\s\S]*factory\(\)/);
  });
});
