import { template as _$template } from "r-dom";
import { delegateEvents as _$delegateEvents } from "r-dom";
import { insert as _$insert } from "r-dom";
import { createComponent as _$createComponent } from "r-dom";
import { spread as _$spread } from "r-dom";
import { mergeProps as _$mergeProps } from "r-dom";
import { ref as _$ref } from "r-dom";
import { effect as _$effect } from "r-dom";
import { setAttribute as _$setAttribute } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(`<div>after`),
  _tmpl$2 = /*#__PURE__*/ _$template(`<div>`),
  _tmpl$3 = /*#__PURE__*/ _$template(`<button>go`),
  _tmpl$4 = /*#__PURE__*/ _$template(`<span>static`),
  _tmpl$5 = /*#__PURE__*/ _$template(`<span>`),
  _tmpl$6 = /*#__PURE__*/ _$template(`<label>`),
  _tmpl$7 = /*#__PURE__*/ _$template(`<div>content`),
  _tmpl$8 = /*#__PURE__*/ _$template(`<span>own`),
  _tmpl$9 = /*#__PURE__*/ _$template(`<h1>fallback`);
var _el$ = _tmpl$();
_$setAttribute(_el$, "data", _tmpl$4());
const staticValue = _el$;
var _el$2 = _tmpl$();
_$effect(
  () =>
    (() => {
      var _el$0 = _tmpl$5();
      _$insert(_el$0, () => state.value);
      return _el$0;
    })(),
  _v$ => {
    _$setAttribute(_el$2, "data", _v$);
  }
);
const dynamicValue = _el$2;
var _el$3 = _tmpl$2();
_$effect(
  () => state.compute(),
  _v$ => {
    _$setAttribute(_el$3, "data", _v$);
  }
);
const iifeValue = _el$3;
var _el$4 = _tmpl$2();
_$effect(
  () => ({
    e: (() => {
      var _el$1 = _tmpl$5();
      _$insert(_el$1, () => state.first);
      return _el$1;
    })(),
    t: (() => {
      var _el$10 = _tmpl$6();
      _$insert(_el$10, () => state.second);
      return _el$10;
    })()
  }),
  ({ e, t }, _p$) => {
    e !== _p$?.e && _$setAttribute(_el$4, "first", e);
    t !== _p$?.t && _$setAttribute(_el$4, "second", t);
  }
);
const multiValues = _el$4;
var _el$5 = _tmpl$3();
_el$5.$$click = () => mount(_tmpl$7());
const handlerValue = _el$5;
var _el$6 = _tmpl$2();
_$ref(() => el => el.appendChild(_tmpl$8()), _el$6);
const refValue = _el$6;
var _el$7 = _tmpl$2();
_$spread(
  _el$7,
  _$mergeProps(props, {
    get data() {
      var _el$13 = _tmpl$5();
      _$insert(_el$13, () => state.value);
      return _el$13;
    }
  }),
  false
);
const spreadValue = _el$7;
var _el$8 = _tmpl$2();
_$insert(
  _el$8,
  _$createComponent(Comp, {
    get fallback() {
      return _tmpl$9();
    }
  })
);
const propValue = _el$8;
_$delegateEvents(["click"]);
