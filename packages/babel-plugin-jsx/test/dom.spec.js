const path = require("path");
const { runFixtures } = require("./fixtures");
const plugin = require("../index");

runFixtures({
  plugin,
  pluginOptions: {
    moduleName: "r-dom",
    builtIns: ["For", "Show"],
    generate: "dom",
    wrapConditionals: true,
    contextToCustomElements: true,
    requireImportSource: false
  },
  title: "Convert JSX",
  fixtures: path.join(__dirname, "__dom_fixtures__")
});
