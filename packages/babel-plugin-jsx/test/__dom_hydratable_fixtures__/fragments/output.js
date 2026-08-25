import { template as _$template } from "r-dom";
import { createComponent as _$createComponent } from "r-dom";
import { memo as _$memo } from "r-dom";
import { setAttribute as _$setAttribute } from "r-dom";
import { effect as _$effect } from "r-dom";
import { getNextElement as _$getNextElement } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(`<div>First`),
  _tmpl$2 = /*#__PURE__*/ _$template(`<div>Last`),
  _tmpl$3 = /*#__PURE__*/ _$template(`<div>`),
  _tmpl$4 = /*#__PURE__*/ _$template(`<span>1`),
  _tmpl$5 = /*#__PURE__*/ _$template(`<span>2`),
  _tmpl$6 = /*#__PURE__*/ _$template(`<span>3`);
const multiStatic = [_$getNextElement(_tmpl$), _$getNextElement(_tmpl$2)];
const multiExpression = [_$getNextElement(_tmpl$), inserted, _$getNextElement(_tmpl$2), "After"];
const multiDynamic = [
  (() => {
    var _el$5 = _$getNextElement(_tmpl$);
    _$effect(
      () => state.first,
      _v$ => {
        _$setAttribute(_el$5, "id", _v$);
      }
    );
    return _el$5;
  })(),
  _$memo(() => state.inserted),
  (() => {
    var _el$6 = _$getNextElement(_tmpl$2);
    _$effect(
      () => state.last,
      _v$ => {
        _$setAttribute(_el$6, "id", _v$);
      }
    );
    return _el$6;
  })(),
  "After"
];
const singleExpression = inserted;
const singleDynamic = _$memo(inserted);
const firstStatic = [inserted, _$getNextElement(_tmpl$3)];
const firstDynamic = [_$memo(inserted), _$getNextElement(_tmpl$3)];
const firstComponent = [_$createComponent(Component, {}), _$getNextElement(_tmpl$3)];
const lastStatic = [_$getNextElement(_tmpl$3), inserted];
const lastDynamic = [_$getNextElement(_tmpl$3), _$memo(inserted)];
const lastComponent = [_$getNextElement(_tmpl$3), _$createComponent(Component, {})];
const spaces = [
  _$getNextElement(_tmpl$4),
  " ",
  _$getNextElement(_tmpl$5),
  " ",
  _$getNextElement(_tmpl$6)
];
const multiLineTrailing = [
  _$getNextElement(_tmpl$4),
  _$getNextElement(_tmpl$5),
  _$getNextElement(_tmpl$6)
];
