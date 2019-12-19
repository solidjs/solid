var jsxTransform = require("babel-plugin-jsx-dom-expressions");

module.exports = function(context, options = {}) {
  return {
    plugins: [
      [
        jsxTransform,
        {
          moduleName: "solid-js/dom",
          builtIns: ["For", "Show", "Switch", "Match", "Suspense", "SuspenseList", "Portal"],
          delegateEvents: true,
          contextToCustomElements: true,
          wrapConditionals: true,
          generate: options.generate || "dom"
        }
      ]
    ]
  };
};
