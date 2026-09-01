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
