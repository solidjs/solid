const path = require("path");
const { runFixtures } = require("./fixtures");
const plugin = require("../index");

runFixtures({
  plugin,
  pluginOptions: {
    moduleName: "r-custom",
    builtIns: ["For", "Show"],
    generate: "universal"
  },
  title: "Convert JSX",
  fixtures: path.join(__dirname, "__universal_fixtures__")
});
