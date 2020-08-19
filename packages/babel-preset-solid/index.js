const jsxTransform = require("babel-plugin-jsx-dom-expressions");
const rename = require("babel-plugin-transform-rename-import");

module.exports = function (context, options = {}) {
  const plugins = [
    [
      jsxTransform,
      Object.assign(
        {
          moduleName: "solid-js/dom",
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
          generate: "dom"
        },
        options
      )
    ]
  ];

  if (options.generate === "ssr" && !options.async)
    plugins.push([
      rename,
      {
        replacements: [
          { original: "solid-js/dom", replacement: "solid-js" },
          { original: "solid-js/server", replacement: "solid-js" },
          { original: "solid-js", replacement: "solid-js/server" }
        ]
      }
    ]);

  return {
    plugins
  };
};
