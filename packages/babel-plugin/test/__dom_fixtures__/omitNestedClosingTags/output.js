import { template as _$template } from "r-dom";
import { getOwner as _$getOwner } from "r-dom";
import { insert as _$insert } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(`<div><form><label>Name <input></label></form><p>`),
  _tmpl$2 = /*#__PURE__*/ _$template(`<div><section><form><input></form></section><form><button>`),
  _tmpl$3 = /*#__PURE__*/ _$template(`<div><my-card><div>body</div></my-card><p>`, 1),
  _tmpl$4 = /*#__PURE__*/ _$template(`<fieldset><legend><h2>Title</h2></legend><p>`),
  _tmpl$5 = /*#__PURE__*/ _$template(`<ul><li>Docs<ul><li>Intro</li></ul></li><li>`),
  _tmpl$6 = /*#__PURE__*/ _$template(`<div><div><svg><foreignObject><div>x</div></svg></div><p>`),
  _tmpl$7 = /*#__PURE__*/ _$template(`<div><p><math><mtext><span>x</span></math></p><p>`);
var _el$ = _tmpl$(),
  _el$2 = _el$.firstChild,
  _el$3 = _el$2.nextSibling;
_$insert(_el$3, value);
const form = _el$;
var _el$4 = _tmpl$2(),
  _el$5 = _el$4.firstChild,
  _el$6 = _el$5.nextSibling,
  _el$7 = _el$6.firstChild;
_$insert(_el$7, value);
const twoForms = _el$4;
var _el$8 = _tmpl$3(),
  _el$9 = _el$8.firstChild,
  _el$0 = _el$9.nextSibling;
_el$9._$owner = _$getOwner();
_$insert(_el$0, value);
const customElement = _el$8;
var _el$1 = _tmpl$4(),
  _el$10 = _el$1.firstChild,
  _el$11 = _el$10.nextSibling;
_$insert(_el$11, value);
const legend = _el$1;
var _el$12 = _tmpl$5(),
  _el$13 = _el$12.firstChild,
  _el$14 = _el$13.nextSibling;
_$insert(_el$14, value);
const nestedList = _el$12;
var _el$15 = _tmpl$6(),
  _el$16 = _el$15.firstChild,
  _el$17 = _el$16.nextSibling;
_$insert(_el$17, value);
const foreignObject = _el$15;
var _el$18 = _tmpl$7(),
  _el$19 = _el$18.firstChild,
  _el$20 = _el$19.nextSibling;
_$insert(_el$20, value);
const mathText = _el$18;
