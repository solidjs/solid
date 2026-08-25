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

  test("SSR does not HTML-escape a sole component child; mixed children and element holes do", () => {
    const ssr = (src, extra = {}) =>
      babel.transformSync(src, {
        plugins: [[plugin, { generate: "ssr", moduleName: "r-server", ...extra }]],
        configFile: false,
        babelrc: false,
        filename: "input.jsx"
      }).code;

    const sole = ssr(`const view = <Comp>{state.dynamic}</Comp>;`);
    expect(sole).toContain("return state.dynamic;");
    expect(sole).not.toMatch(/_\$escape\(state\.dynamic\)/);

    const mixed = ssr(`const view = <Comp><div />{state.dynamic}</Comp>;`);
    expect(mixed).toMatch(/_\$escape\(state\.dynamic\)/);

    const element = ssr(`const view = <div>{state.dynamic}</div>;`);
    expect(element).toMatch(/_\$escape\(state\.dynamic\)/);
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
