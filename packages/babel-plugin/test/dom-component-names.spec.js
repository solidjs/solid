const path = require("path");
const { runFixtures } = require("./fixtures");
const plugin = require("../index");

runFixtures({
  plugin,
  pluginOptions: {
    moduleName: "r-dom",
    builtIns: ["For", "Show"],
    generate: "dom",
    sourceNames: { components: true },
    contextToCustomElements: true
  },
  title: "Convert JSX (sourceNames.components)",
  fixtures: path.join(__dirname, "__dom_component_names_fixtures__")
});
