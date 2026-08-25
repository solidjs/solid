const path = require("path");
const { runFixtures } = require("./fixtures");
const plugin = require("../index");

runFixtures({
  plugin,
  pluginOptions: {
    moduleName: "r-dom",
    builtIns: ["For", "Show"],
    generate: "dom",
    hydratable: true,
    dev: true,
    contextToCustomElements: true
  },
  title: "Convert JSX (dev hydratable)",
  fixtures: path.join(__dirname, "__dom_hydratable_dev_fixtures__")
});
