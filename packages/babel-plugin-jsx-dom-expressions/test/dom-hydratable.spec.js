const path = require('path')
const pluginTester = require('babel-plugin-tester').default;
const plugin = require('../index');

pluginTester({
  plugin,
  pluginOptions: {
    moduleName: 'r-dom',
    builtIns: ['For', 'Show'],
    generate: "dom",
    hydratable: true,
    contextToCustomElements: true,
    staticMarker: "@once",
    wrapSpreads: false
  },
  title: 'Convert JSX',
  fixtures: path.join(__dirname, '__dom_hydratable_fixtures__'),
  snapshot: true
});
