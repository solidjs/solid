const fs = require("fs");
const path = require("path");
const { transform } = require("../index");

// Reuses the Babel plugin's server-components fixture source: under
// `serverComponents: true`, ref/on* positions on intrinsic elements compile
// to one guarded `_$ssrClaim` hole per element instead of dropping.
const babelFixtures = path.resolve(
  __dirname,
  "../../babel-plugin-jsx/test/__ssr_server_components_fixtures__"
);
const oxcFixtures = path.resolve(__dirname, "fixtures/ssr-server-components");

const fixtures = ["behaviorClaims"];

function transformSsr(code, fixture, serverComponents) {
  return (
    transform(code, {
      filename: `${fixture}.jsx`,
      moduleName: "r-server",
      generate: "ssr",
      serverComponents
    }).code.trimEnd() + "\n"
  );
}

describe("SSR serverComponents behavior claims", () => {
  it.each(fixtures)("matches generated Oxc output: %s", fixture => {
    const source = fs.readFileSync(path.join(babelFixtures, fixture, "code.js"), "utf8");
    const output = transformSsr(source, fixture, true);
    const outputPath = path.join(oxcFixtures, fixture, "output.js");
    if (process.env.UPDATE_OXC_FIXTURES === "1") {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, output);
    }
    expect(output).toBe(fs.readFileSync(outputPath, "utf8"));
  });

  it("stays inert when the option is off — refs hoist, on* drops, no claim import", () => {
    const source = fs.readFileSync(path.join(babelFixtures, "behaviorClaims", "code.js"), "utf8");
    const output = transformSsr(source, "behaviorClaims", false);
    expect(output).not.toContain("ssrClaim");
    expect(output).not.toContain("sharedConfig");
  });
});
