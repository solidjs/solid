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
  const babel = compileBabel(source, options, "code-block-parity.tsrx");
  const oxc = compileOxc(source, "code-block-parity", options, ".tsrx");
  expect(normalize(oxc)).toBe(normalize(babel));
}

describe("native TSRX statement-container parity", () => {
  test.each(["dom", "ssr", "universal"])("preserves setup ASI in %s", generate => {
    for (const newline of ["\n", "\r\n"]) {
      for (const setup of [
        "const a = () => 1",
        "const a = () => 1;",
        "const a = () => 1 // café 🚀",
        "const a = () => 1 /* café 🚀 */",
        "const a = () => (\n  1 +\n  2\n)",
        "const a = () => ({ value: 1 }).value",
        "const a = () => 1\nconst b = a\nb()",
        "const a = () => 1\n;[1].forEach(a)"
      ]) {
        const source = `export function F() @{\n${setup}\n<div>{a()}</div>\n}`.replaceAll(
          "\n",
          newline
        );
        const modeOptions = { ...options, generate };
        expect(normalize(compileOxc(source, "setup-asi", modeOptions, ".tsrx"))).toBe(
          normalize(compileBabel(source, modeOptions, "setup-asi.tsrx"))
        );
      }
    }
  });

  test("matches nested expression-position containers", () => {
    compare(`
      export const view = @{
        const inner = @{
          const label = "inner";
          <span>{label}</span>
        };
        <main>{inner}</main>
      };
    `);
  });

  test("matches default-exported containers", () => {
    compare(`
      export default @{
        const label = "default";
        <main>{label}</main>
      };
    `);
  });
});
