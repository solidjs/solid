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
    requireImportSource: false,
    omitLastClosingTag: false,
    omitQuotes: false,
    omitAttributeSpacing: false
  },
  title: "Convert JSX omitAttributeSpacing: false",
  fixtures: path.join(__dirname, "__dom_omit_attribute_spacing_no_omit_fixtures__")
});
