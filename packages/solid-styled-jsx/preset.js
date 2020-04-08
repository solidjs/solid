var styled = require("styled-jsx/babel");
var rename = require("babel-plugin-transform-rename-import");

module.exports = function(context, options = {}) {
  return {
    plugins: [
      [styled, options],
      [
        rename,
        {
          replacements: [
            {
              original: "styled-jsx/style",
              replacement: "solid-styled-jsx/style"
            }
          ]
        }
      ]
    ]
  };
};
