const path = require("path");
const { runFixtures } = require("./fixtures");
const plugin = require("../index");

runFixtures({
  plugin,
  pluginOptions: {
    moduleName: "r-server",
    builtIns: ["For", "Show"],
    generate: "ssr",
    wrapConditionals: true,
    contextToCustomElements: true,
    requireImportSource: false
  },
  title: "Convert JSX",
  fixtures: path.join(__dirname, "__ssr_fixtures__")
});
