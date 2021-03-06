module.exports = {
  env: {
    test: {
      presets: [["@babel/preset-env", { targets: { node: "current" } }], "@babel/preset-typescript"]
    },
    development: {
      presets: ["@babel/preset-typescript"],
      plugins: [
        [
          "babel-plugin-jsx-dom-expressions",
          {
            moduleName: "solid-js/web",
            contextToCustomElements: true,
            wrapConditionals: true,
            builtIns: ["For", "Show", "Switch", "Match", "Suspense", "SuspenseList", "Portal"]
          }
        ]
      ]
    }
  }
};
