const path = require("path");
const { runFixtures } = require("./fixtures");
const plugin = require("../index");

runFixtures({
  plugin,
  pluginOptions: {
    moduleName: "r-custom",
    builtIns: ["For", "Show", "Switch", "Match", "Errored", "Loading", "Dynamic"],
    generate: "universal"
  },
  title: "Convert TSRX",
  fixtures: path.join(__dirname, "__tsrx_universal_fixtures__")
});
