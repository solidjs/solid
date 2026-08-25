import { template as _$template } from "r-dom";
import { setAttributeNS as _$setAttributeNS } from "r-dom";
import { createComponent as _$createComponent } from "r-custom";
import { spread as _$spread } from "r-dom";
import { setStyleProperty as _$setStyleProperty } from "r-dom";
import { setAttribute as _$setAttribute } from "r-dom";
import { className as _$className } from "r-dom";
import { effect as _$effect } from "r-custom";
var _tmpl$ = /*#__PURE__*/ _$template(
    `<svg width=400 height=180><rect stroke-width=2 x=50 y=20 rx=20 ry=20 width=150 height=150 style=fill:red;stroke:black;stroke-width:5;opacity:0.5></rect><linearGradient gradientTransform=rotate(25)><stop offset=0%>`
  ),
  _tmpl$2 = /*#__PURE__*/ _$template(
    `<svg width=400 height=180><rect rx=20 ry=20 width=150 height=150 style=fill:red;stroke:black;opacity:0.5>`
  ),
  _tmpl$3 = /*#__PURE__*/ _$template(`<svg width=400 height=180><rect>`),
  _tmpl$4 = /*#__PURE__*/ _$template(`<svg><rect x=50 y=20 width=150 height=150></svg>`, 2),
  _tmpl$5 = /*#__PURE__*/ _$template(`<svg viewBox="0 0 160 40"><a><text x=10 y=25>MDN Web Docs`),
  _tmpl$6 = /*#__PURE__*/ _$template(`<svg viewBox="0 0 160 40"><text x=10 y=25>`);
const template = _tmpl$();
var _el$2 = _tmpl$2(),
  _el$3 = _el$2.firstChild;
_$effect(
  () => ({
    e: state.name,
    t: state.width,
    a: state.x,
    o: state.y,
    i: props.stroke
  }),
  ({ e, t, a, o, i }, _p$) => {
    _$className(_el$3, e, _p$?.e);
    t !== _p$?.t && _$setAttribute(_el$3, "stroke-width", t);
    a !== _p$?.a && _$setAttribute(_el$3, "x", a);
    o !== _p$?.o && _$setAttribute(_el$3, "y", o);
    i !== _p$?.i && _$setStyleProperty(_el$3, "stroke-width", i);
  }
);
const template2 = _el$2;
var _el$4 = _tmpl$3(),
  _el$5 = _el$4.firstChild;
_$spread(_el$5, props, false);
const template3 = _el$4;
const template4 = _tmpl$4();
const template5 = _tmpl$4();
const template6 = _$createComponent(Component, {
  get children() {
    return _tmpl$4();
  }
});
var _el$9 = _tmpl$5(),
  _el$0 = _el$9.firstChild;
_$setAttributeNS(_el$0, "http://www.w3.org/1999/xlink", "xlink:href", url);
const template7 = _el$9;
var _el$1 = _tmpl$6(),
  _el$10 = _el$1.firstChild;
_el$10.textContent = text;
const template8 = _el$1;
