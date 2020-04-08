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
            moduleName: "solid-js/dom",
            contextToCustomElements: true,
            wrapConditionals: true,
            wrapFragments: true,
            builtIns: ["For", "Show", "Switch", "Match", "Suspense", "SuspenseList", "Portal"]
          }
        ]
      ]
    }
  }
};
