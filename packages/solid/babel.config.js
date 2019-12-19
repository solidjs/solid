module.exports = {
  env: {
    test: {
      presets: [
        ["@babel/preset-env", { targets: { node: "current" } }],
        "@babel/preset-typescript"
      ],
      plugins: [
        [
          "babel-plugin-jsx-dom-expressions",
          {
            moduleName: "../../src/dom/index",
            contextToCustomElements: true,
            wrapConditionals: true,
            builtIns: ["For", "Show", "Switch", "Match", "Suspense", "SuspenseList", "Portal"]
          }
        ]
      ]
    }
  }
};
