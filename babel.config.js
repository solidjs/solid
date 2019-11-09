module.exports = {
  env: {
    test: {
      presets: [['@babel/preset-env', {targets: {node: 'current'}}]],
      plugins: [['babel-plugin-jsx-dom-expressions', {moduleName: '../../dist/dom/index.js', contextToCustomElements: true, wrapConditionals: true, builtIns: ['For', 'Show', 'Switch', 'Match', 'Suspense', 'Portal']}]]
    }
  }
};