const babel = require("@babel/core");
const plugin = require("../index");

describe("Solid 2.0 defaults", () => {
  test("omitted options use @solidjs/web and auto-import control-flow components", () => {
    const { code } = babel.transformSync(`const view = <For each={list}>{item => item}</For>;`, {
      plugins: [plugin],
      configFile: false,
      babelrc: false,
      filename: "input.jsx"
    });
    expect(code).toContain('from "@solidjs/web"');
    expect(code).toMatch(/For as _\$For/);
  });

  test("SSR escapes at element holes only; component children (sole, mixed, fragments) are values", () => {
    const ssr = (src, extra = {}) =>
      babel.transformSync(src, {
        plugins: [[plugin, { generate: "ssr", moduleName: "r-server", ...extra }]],
        configFile: false,
        babelrc: false,
        filename: "input.jsx"
      }).code;

    // Values flow to the hole that inserts them; that hole's `_$escape`
    // covers strings, array items and what a function yields. Escaping the
    // value as well double-escapes through `<Comp>{props.children}</Comp>`.
    const sole = ssr(`const view = <Comp>{state.dynamic}</Comp>;`);
    expect(sole).toContain("return state.dynamic;");
    expect(sole).not.toMatch(/_\$escape\(/);

    const mixed = ssr(`const view = <Comp><div />{state.dynamic}</Comp>;`);
    expect(mixed).toMatch(/_\$memo\(\(\) => state\.dynamic\)/);
    expect(mixed).not.toMatch(/_\$escape\(/);

    const fragment = ssr(`const view = <>{state.dynamic}<div /></>;`);
    expect(fragment).toMatch(/_\$memo\(\(\) => state\.dynamic\)/);
    expect(fragment).not.toMatch(/_\$escape\(/);

    const element = ssr(`const view = <div>{state.dynamic}</div>;`);
    expect(element).toMatch(/_\$escape\(state\.dynamic\)/);

    // A single-expression fragment at a hole is a memo, not an escape-immune
    // node: the hole keeps its wrap (the runtime defers into the memo).
    const fragmentHole = ssr(`const view = <div>{c ? <>{state.dynamic}</> : null}</div>;`);
    expect(fragmentHole).toMatch(/_\$escape\(_\$memo\(\(\) => state\.dynamic\)\)/);

    // A single native element in a fragment is an `_$ssr` node — immune.
    const elementFragmentHole = ssr(`const view = <div>{c ? <><span /></> : null}</div>;`);
    expect(elementFragmentHole).toMatch(/c \? _\$ssr\(_tmpl\$2\) : _\$escape\(null\)/);
  });

  test("builtIns: [] opts out of auto-import", () => {
    const { code } = babel.transformSync(`const view = <For each={list}>{item => item}</For>;`, {
      plugins: [[plugin, { builtIns: [] }]],
      configFile: false,
      babelrc: false,
      filename: "input.jsx"
    });
    expect(code).not.toMatch(/For as _\$For/);
  });
});
