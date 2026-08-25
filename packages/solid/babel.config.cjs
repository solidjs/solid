const path = require("path");

module.exports = {
  env: {
    test: {
      presets: [
        ["@babel/preset-env", { targets: { node: "current" } }],
        "@babel/preset-typescript"
      ],
      plugins: [
        [
          "@solidjs/babel-plugin",
          {
            moduleName: path.join(__dirname, "../web/src/index"),
            contextToCustomElements: true,
            wrapConditionals: true
          }
        ]
      ]
    }
  }
};
