const path = require("path");
const { runFixtures } = require("./fixtures");
const plugin = require("../index");

runFixtures({
  plugin,
  pluginOptions: {
    moduleName: "r-server",
    builtIns: ["For", "Show"],
    generate: "ssr",
    hydratable: true,
    contextToCustomElements: true
  },
  title: "Convert JSX",
  fixtures: path.join(__dirname, "__ssr_hydratable_fixtures__")
});
