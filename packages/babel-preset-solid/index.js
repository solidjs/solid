var jsxTransform = require("babel-plugin-jsx-dom-expressions");

module.exports = function(context, options = {}) {
  return {
    plugins: [
      [
        jsxTransform,
        Object.assign({
          moduleName: "solid-js/dom",
          builtIns: ["For", "Show", "Switch", "Match", "Suspense", "SuspenseList", "Portal", "Index", "Dynamic"],
          delegateEvents: true,
          contextToCustomElements: true,
          wrapConditionals: true,
          generate: "dom"
        }, options)
      ]
    ]
  };
};
