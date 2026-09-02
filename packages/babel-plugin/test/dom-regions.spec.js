const path = require("path");
const { runFixtures } = require("./fixtures");
const plugin = require("../index");

// Region emission snapshots (DESIGN-REGIONS §9-10): the ABSOLUTE anchor for
// the compiled-output contract — the Oxc parity suites pin the native
// compiler against these fixtures relatively, so this directory is what
// actually defines the emitted shape. Contract changes must land here as
// reviewed snapshot diffs.
runFixtures({
  plugin,
  pluginOptions: {
    moduleName: "r-dom",
    builtIns: ["For", "Show"],
    generate: "dom",
    wrapConditionals: true,
    contextToCustomElements: true,
    requireImportSource: false,
    regions: true
  },
  title: "Convert JSX (regions)",
  fixtures: path.join(__dirname, "__dom_regions_fixtures__")
});
