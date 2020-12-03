const path = require('path')
const pluginTester = require('babel-plugin-tester').default;
const plugin = require('../index');

pluginTester({
  plugin,
  pluginOptions: {
    moduleName: 'r-dom',
    builtIns: ['For', 'Show'],
    generate: "dom",
    delegateEvents: true,
    wrapConditionals: true,
    contextToCustomElements: true,
    staticMarker: "@once",
    wrapSpreads: false
  },
  title: 'Convert JSX',
  fixtures: path.join(__dirname, '__dom_fixtures__'),
  snapshot: true
});
