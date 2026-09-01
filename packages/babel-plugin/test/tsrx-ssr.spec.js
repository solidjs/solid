const path = require("path");
const { runFixtures } = require("./fixtures");
const plugin = require("../index");

runFixtures({
  plugin,
  pluginOptions: {
    moduleName: "r-server",
    builtIns: ["For", "Show", "Switch", "Match", "Errored", "Loading", "Dynamic"],
    generate: "ssr",
    wrapConditionals: true,
    contextToCustomElements: true,
    requireImportSource: false
  },
  title: "Convert TSRX",
  fixtures: path.join(__dirname, "__tsrx_ssr_fixtures__")
});
