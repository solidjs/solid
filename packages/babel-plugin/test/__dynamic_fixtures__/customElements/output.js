import { template as _$template } from "r-dom";
import { effect as _$effect } from "r-custom";
import { getOwner as _$getOwner } from "r-dom";
import { setAttribute as _$setAttribute } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(`<my-element>`, 1),
  _tmpl$2 = /*#__PURE__*/ _$template(`<my-element><header slot=head>Title`, 1),
  _tmpl$3 = /*#__PURE__*/ _$template(`<slot name=head>`),
  _tmpl$4 = /*#__PURE__*/ _$template(`<a is=my-element>`, 1);
var _el$ = _tmpl$();
_$setAttribute(_el$, "some-attr", name);
_$setAttribute(_el$, "notProp", data);
_$setAttribute(_el$, "my-attr", data);
_el$.someProp = data;
_el$._$owner = _$getOwner();
const template = _el$;
var _el$2 = _tmpl$();
_el$2._$owner = _$getOwner();
_$effect(
  () => ({
    e: state.name,
    t: state.data,
    a: state.data,
    o: state.data
  }),
  ({ e, t, a, o }, _p$) => {
    e !== _p$?.e && _$setAttribute(_el$2, "some-attr", e);
    t !== _p$?.t && _$setAttribute(_el$2, "notProp", t);
    a !== _p$?.a && _$setAttribute(_el$2, "my-attr", a);
    o !== _p$?.o && (_el$2.someProp = o);
  }
);
const template2 = _el$2;
var _el$3 = _tmpl$2();
_el$3._$owner = _$getOwner();
const template3 = _el$3;
const template4 = (() => {
  var _el$4 = _tmpl$3();
  _el$4._$owner = _$getOwner();
  return _el$4;
})();
var _el$5 = _tmpl$4();
_el$5._$owner = _$getOwner();
const template5 = _el$5;
