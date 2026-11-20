import { template as _$template } from "r-dom";
import { setAttribute as _$setAttribute } from "r-dom";
import { effect as _$effect } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(
    `<div id=main><style>div \{ color: red; }</style><h1>Welcome</h1><label for=entry>Edit:</label><input id=entry type=text>`
  ),
  _tmpl$2 = /*#__PURE__*/ _$template(`<div><span><a></a></span><span>`),
  _tmpl$3 = /*#__PURE__*/ _$template(`<div><div><table><tbody></tbody></table></div><div>`),
  _tmpl$4 = /*#__PURE__*/ _$template(
    `<div><div><footer><div></div></footer></div><div><button><span>0`
  ),
  _tmpl$5 = /*#__PURE__*/ _$template(`<div><noscript>`),
  _tmpl$6 = /*#__PURE__*/ _$template(`<noscript>`);
const template = _tmpl$();
const template2 = _tmpl$2();
const template3 = _tmpl$3();
const template4 = _tmpl$4();
const template5 = _tmpl$5();
const template6 = _tmpl$6();
var _el$7 = _tmpl$5(),
  _el$8 = _el$7.firstChild;
_$effect(
  () => id(),
  _v$ => {
    _$setAttribute(_el$8, "data-id", _v$);
  }
);
const template7 = _el$7;
