const fs = require("fs");
const path = require("path");
const babel = require("@babel/core");
const prettier = require("prettier");

async function snapshotText(code, filepath) {
  const config = (await prettier.resolveConfig(filepath)) ?? {};
  const parser = /\.tsx?$/.test(filepath) ? "babel-ts" : "babel";
  return prettier.format(code, { ...config, filepath, parser });
}

function createFixtureTests(fixturesDir, options) {
  if (!fs.statSync(fixturesDir).isDirectory()) return;

  const rootOptionsPath = path.join(fixturesDir, "options.json");
  const rootFixtureOptions = fs.existsSync(rootOptionsPath) ? require(rootOptionsPath) : {};

  for (const caseName of fs.readdirSync(fixturesDir)) {
    const fixtureDir = path.join(fixturesDir, caseName);
    if (!fs.statSync(fixtureDir).isDirectory()) continue;

    const optionsPath = path.join(fixtureDir, "options.json");
    const fixturePluginOptions = fs.existsSync(optionsPath) ? require(optionsPath) : {};
    const codePath = ["code.js", "code.ts", "code.jsx", "code.tsx", "code.tsrx"]
      .map(name => path.join(fixtureDir, name))
      .find(candidate => fs.existsSync(candidate));
    const pluginOptions = {
      ...rootFixtureOptions,
      ...options.pluginOptions,
      ...fixturePluginOptions
    };
    const blockTitle = caseName.split("-").join(" ");

    if (!codePath) {
      describe(blockTitle, () => {
        createFixtureTests(fixtureDir, { ...options, pluginOptions });
      });
      continue;
    }

    test(blockTitle, async () => {
      const extraPlugins = options.babelOptions?.plugins ?? [];
      const hasBabelrc = [".babelrc", ".babelrc.js", ".babelrc.cjs"].some(file =>
        fs.existsSync(path.join(fixtureDir, file))
      );
      const transformed = await babel.transformAsync(fs.readFileSync(codePath, "utf8"), {
        babelrc: hasBabelrc,
        configFile: false,
        ...options.babelOptions,
        plugins: [[options.plugin, pluginOptions], ...extraPlugins],
        filename: codePath
      });
      const sourceExt = codePath.split(".").pop();
      // TSRX sources compile to plain JS output (the frontend desugars the
      // template syntax before the shared JSX lowering runs).
      const ext =
        fixturePluginOptions.fixtureOutputExt ?? (sourceExt === "tsrx" ? ".js" : `.${sourceExt}`);
      const outputPath = path.join(fixtureDir, `output${ext}`);
      await expect(await snapshotText(transformed.code, outputPath)).toMatchFileSnapshot(
        outputPath
      );
    });
  }
}

function runFixtures({ plugin, pluginOptions, fixtures, title = "unknown plugin", babelOptions }) {
  describe(`${title} fixtures`, () => {
    createFixtureTests(fixtures, { plugin, pluginOptions, babelOptions });
  });
}

module.exports = { runFixtures };
