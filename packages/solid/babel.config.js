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
                replacement: "../../../packages/solid/web/src/core"
              },
              {
                original: "^solid-js$",
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
