import { createComponent as _$createComponent } from "r-custom";
import { memo as _$memo } from "r-custom";
import { setProp as _$setProp } from "r-custom";
import { effect as _$effect } from "r-custom";
import { createTextNode as _$createTextNode } from "r-custom";
import { insertNode as _$insertNode } from "r-custom";
import { createElement as _$createElement } from "r-custom";
const multiStatic = [
  (() => {
    var _el$ = _$createElement("div");
    _$insertNode(_el$, _$createTextNode(`First`));
    return _el$;
  })(),
  (() => {
    var _el$3 = _$createElement("div");
    _$insertNode(_el$3, _$createTextNode(`Last`));
    return _el$3;
  })()
];
const multiExpression = [
  (() => {
    var _el$5 = _$createElement("div");
    _$insertNode(_el$5, _$createTextNode(`First`));
    return _el$5;
  })(),
  inserted,
  (() => {
    var _el$7 = _$createElement("div");
    _$insertNode(_el$7, _$createTextNode(`Last`));
    return _el$7;
  })(),
  "After"
];
const multiDynamic = [
  (() => {
    var _el$9 = _$createElement("div");
    _$insertNode(_el$9, _$createTextNode(`First`));
    _$effect(
      () => state.first,
      (_v$, _$p) => {
        _$setProp(_el$9, "id", _v$, _$p);
      }
    );
    return _el$9;
  })(),
  _$memo(() => state.inserted),
  (() => {
    var _el$1 = _$createElement("div");
    _$insertNode(_el$1, _$createTextNode(`Last`));
    _$effect(
      () => state.last,
      (_v$, _$p) => {
        _$setProp(_el$1, "id", _v$, _$p);
      }
    );
    return _el$1;
  })(),
  "After"
];
const singleExpression = inserted;
const singleDynamic = _$memo(inserted);
const firstStatic = [inserted, _$createElement("div")];
const firstDynamic = [_$memo(inserted), _$createElement("div")];
const firstComponent = [_$createComponent(Component, {}), _$createElement("div")];
const lastStatic = [_$createElement("div"), inserted];
const lastDynamic = [_$createElement("div"), _$memo(inserted)];
const lastComponent = [_$createElement("div"), _$createComponent(Component, {})];
const spaces = [
  (() => {
    var _el$17 = _$createElement("span");
    _$insertNode(_el$17, _$createTextNode(`1`));
    return _el$17;
  })(),
  " ",
  (() => {
    var _el$19 = _$createElement("span");
    _$insertNode(_el$19, _$createTextNode(`2`));
    return _el$19;
  })(),
  " ",
  (() => {
    var _el$21 = _$createElement("span");
    _$insertNode(_el$21, _$createTextNode(`3`));
    return _el$21;
  })()
];
const multiLineTrailing = [
  (() => {
    var _el$23 = _$createElement("span");
    _$insertNode(_el$23, _$createTextNode(`1`));
    return _el$23;
  })(),
  (() => {
    var _el$25 = _$createElement("span");
    _$insertNode(_el$25, _$createTextNode(`2`));
    return _el$25;
  })(),
  (() => {
    var _el$27 = _$createElement("span");
    _$insertNode(_el$27, _$createTextNode(`3`));
    return _el$27;
  })()
];
