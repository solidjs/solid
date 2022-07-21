const path = require('path');

module.exports = {
  env: {
    test: {
      presets: [
        ["@babel/preset-env", { targets: { node: "current" } }],
        "@babel/preset-typescript"
      ],
      plugins: [
        [
          "babel-plugin-transform-rename-import",
          {
            replacements: [
              {
                original: "rxcore",
                replacement: path.join(__dirname, "../../packages/solid/web/src/core")
              },
              {
                original: "^solid-js$",
                replacement: path.join(__dirname, "src"),
              }
            ]
          }
        ],
        [
          "babel-plugin-jsx-dom-expressions",
          {
            moduleName: path.join(__dirname, "web/src/index"),
            contextToCustomElements: true,
            wrapConditionals: true
          }
        ]
      ]
    }
  }
};
