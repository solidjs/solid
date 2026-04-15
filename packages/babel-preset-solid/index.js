const jsxTransform = require("babel-plugin-jsx-dom-expressions");

module.exports = function (context, options = {}) {
  const plugins = [
    [
      jsxTransform,
      Object.assign(
        {
          moduleName: "@solidjs/web",
          builtIns: [
            "For",
            "Show",
            "Switch",
            "Match",
            "Loading",
            "Reveal",
            "Portal",
            "Repeat",
            "Dynamic",
            "Errored"
          ],
          contextToCustomElements: true,
          wrapConditionals: true,
          generate: "dom"
        },
        options
      )
    ]
  ];

  return {
    plugins
  };
};
