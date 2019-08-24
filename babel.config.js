module.exports = {
  env: {
    test: {
      //presets: [['@babel/preset-env', {targets: {node: 'current'}}]],
      //plugins: [['babel-plugin-jsx-dom-expressions', {moduleName: '../../dist/dom/index.js', contextToCustomElements: true, builtIns: ['For', 'Show', 'Switch', 'Match', 'Suspense', 'Portal']}]]
      "presets": [
        ['@babel/preset-env', {targets: {node: 'current'}}],
        "@babel/preset-typescript",
      ],
      "plugins": [
        [
          "babel-plugin-jsx-dom-expressions",
          {
            "moduleName": "../../dist/dom/index.js",
            contextToCustomElements: true,
            builtIns: ['For', 'Show', 'Switch', 'Match', 'Suspense', 'Portal']
          }
        ],
      ]

    }
  }
};