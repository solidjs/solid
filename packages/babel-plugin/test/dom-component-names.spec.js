const path = require("path");
const { runFixtures } = require("./fixtures");
const plugin = require("../index");

runFixtures({
  plugin,
  pluginOptions: {
    moduleName: "r-dom",
    builtIns: ["For", "Show"],
    generate: "dom",
    componentNames: true,
    contextToCustomElements: true
  },
  title: "Convert JSX (componentNames)",
  fixtures: path.join(__dirname, "__dom_component_names_fixtures__")
});
