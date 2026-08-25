const path = require("path");
const { runFixtures } = require("./fixtures");
const plugin = require("../index");

runFixtures({
  plugin,
  pluginOptions: {
    moduleName: "r-dom",
    builtIns: ["For", "Show"],
    generate: "dom",
    wrapConditionals: false,
    delegateEvents: false,
    effectWrapper: false,
    memoWrapper: false,
    contextToCustomElements: true
  },
  title: "Convert JSX",
  fixtures: path.join(__dirname, "__dom_wrapperless_fixtures__")
});
