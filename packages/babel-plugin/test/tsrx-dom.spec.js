const path = require("path");
const { runFixtures } = require("./fixtures");
const plugin = require("../index");

runFixtures({
  plugin,
  pluginOptions: {
    moduleName: "r-dom",
    builtIns: ["For", "Show", "Switch", "Match", "Errored", "Loading", "Dynamic"],
    generate: "dom",
    wrapConditionals: true,
    contextToCustomElements: true,
    requireImportSource: false
  },
  title: "Convert TSRX",
  fixtures: path.join(__dirname, "__tsrx_dom_fixtures__")
});
