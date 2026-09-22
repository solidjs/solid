const path = require("path");
const { runFixtures } = require("./fixtures");
const plugin = require("../index");

// `sourceNames: true` — every kind on: component labels as `createComponent`'s
// third argument and binding effects named by what they write.
runFixtures({
  plugin,
  pluginOptions: {
    moduleName: "r-dom",
    builtIns: ["For", "Show"],
    generate: "dom",
    sourceNames: true,
    contextToCustomElements: true
  },
  title: "Convert JSX (sourceNames)",
  fixtures: path.join(__dirname, "__dom_source_names_fixtures__")
});
