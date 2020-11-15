const jsxTransform = require("babel-plugin-jsx-dom-expressions");
const rename = require("babel-plugin-transform-rename-import");

module.exports = function (context, options = {}) {
  const plugins = [
    [
      jsxTransform,
      Object.assign(
        {
          moduleName: "solid-js/web",
          builtIns: [
            "For",
            "Show",
            "Switch",
            "Match",
            "Suspense",
            "SuspenseList",
            "Portal",
            "Index",
            "Dynamic",
            "ErrorBoundary"
          ],
          delegateEvents: true,
          contextToCustomElements: true,
          wrapConditionals: true,
          wrapSpreads: false,
          generate: "dom"
        },
        options
      )
    ]
  ];

  if (options.generate === "ssr") {
    if (options.async) {
      plugins.push([
        rename,
        {
          replacements: [
            { original: "solid-js/web", replacement: "solid-js/server-async" },
          ]
        }
      ]);
    } else {
      plugins.push([
        rename,
        {
          replacements: [
            { original: "solid-js/web", replacement: "solid-js/server" },
            { original: "^solid-js$", replacement: "solid-js/static" }
          ]
        }
      ]);
    }
  }

  return {
    plugins
  };
};
