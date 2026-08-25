import { template as _$template } from "r-dom";
import { className as _$className } from "r-dom";
import { effect as _$effect } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(`<div class=b>static static`),
  _tmpl$2 = /*#__PURE__*/ _$template(`<div>static + dynamic`),
  _tmpl$3 = /*#__PURE__*/ _$template(`<div class=on>two dynamic`),
  _tmpl$4 = /*#__PURE__*/ _$template(`<div class=active>mixed`),
  _tmpl$5 = /*#__PURE__*/ _$template(`<div class=c>three statics`);
// Multiple class= attributes on a DOM element should be combined into
// a single class attribute/expression.
const dynamicClass = () => "dyn";
const flag = true;
const t1 = _tmpl$();
var _el$2 = _tmpl$2();
_$effect(
  () => dynamicClass(),
  (_v$, _$p) => {
    _$className(_el$2, _v$, _$p);
  }
);
const t2 = _el$2;
const t3 = _tmpl$3();
const t4 = _tmpl$4();
const t5 = _tmpl$5();
