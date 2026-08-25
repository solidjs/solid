const path = require("path");
const { runFixtures } = require("./fixtures");
const plugin = require("../index");

runFixtures({
  plugin,
  pluginOptions: {
    moduleName: "r-custom",
    builtIns: ["For", "Show"],
    generate: "dynamic",
    renderers: [
      {
        name: "dom",
        elements: [
          "table",
          "tbody",
          "div",
          "h1",
          "span",
          "header",
          "footer",
          "slot",
          "my-el",
          "my-element",
          "module",
          "input",
          "img",
          "iframe",
          "button",
          "a",
          "svg",
          "rect",
          "x",
          "y",
          "linearGradient",
          "stop",
          "style",
          "li",
          "ul",
          "label",
          "text",
          "namespace:tag",
          "path",
          "noscript",
          "select",
          "option",
          "video"
        ],
        moduleName: "r-dom"
      }
    ],
    contextToCustomElements: true,
    wrapConditionals: true
  },
  title: "Convert JSX",
  fixtures: path.join(__dirname, "__dynamic_fixtures__")
});
