// babel.config.js
module.exports = {
  presets: ['@babel/preset-env'],
  plugins: [
    [
      "babel-plugin-transform-rename-import",
      {
        original: "rxcore",
        replacement: "../test/core"
      }
    ]
  ]
};