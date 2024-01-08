const babel = require("@babel/core");
const preset = require(".");
const assert = require("assert");

const { code } = babel.transformSync("const v = <div a b={2} />;", {
  presets: [preset],
  babelrc: false,
  compact: true
});

assert.equal(
  code,
  'import{template as _$template}from"solid-js/web";var _tmpl$=/*#__PURE__*/_$template(`<div a b=2>`);const v=_tmpl$();'
);
console.log("passed");
