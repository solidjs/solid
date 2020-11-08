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
                replacement: "../../../packages/solid/src/shared/core"
              },
              {
                original: "^../..$",
                replacement: "../../src",
              }
            ]
          }
        ],
        [
          "babel-plugin-jsx-dom-expressions",
          {
            moduleName: "../../web/src/index",
            contextToCustomElements: true,
            wrapConditionals: true
          }
        ]
      ]
    }
  }
};
