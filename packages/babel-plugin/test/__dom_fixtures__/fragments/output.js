import { template as _$template } from "r-dom";
import { createComponent as _$createComponent } from "r-dom";
import { memo as _$memo } from "r-dom";
import { setAttribute as _$setAttribute } from "r-dom";
import { effect as _$effect } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(`<div>First</div><div>Last</div>`, 4),
  _tmpl$2 = /*#__PURE__*/ _$template(`<div>First`),
  _tmpl$3 = /*#__PURE__*/ _$template(`<div>Last`),
  _tmpl$4 = /*#__PURE__*/ _$template(`<div>`),
  _tmpl$5 = /*#__PURE__*/ _$template(`<span>1`),
  _tmpl$6 = /*#__PURE__*/ _$template(`<span>2`),
  _tmpl$7 = /*#__PURE__*/ _$template(`<span>3`),
  _tmpl$8 = /*#__PURE__*/ _$template(`<span>1</span><span>2</span><span>3</span>`, 4),
  _tmpl$9 = /*#__PURE__*/ _$template(`<header>First</header><div>Second</div>`, 4),
  _tmpl$0 = /*#__PURE__*/ _$template(`<span>Third</span><footer>Fourth</footer>`, 4),
  _tmpl$1 = /*#__PURE__*/ _$template(`<input><img>`, 4),
  _tmpl$10 = /*#__PURE__*/ _$template(`<img loading=lazy><iframe loading=lazy></iframe>`, 5);
const multiStatic = _tmpl$();
const multiExpression = [_tmpl$2(), inserted, _tmpl$3(), "After"];
const multiDynamic = [
  (() => {
    var _el$5 = _tmpl$2();
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
    var _el$6 = _tmpl$3();
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
const firstStatic = [inserted, _tmpl$4()];
const firstDynamic = [_$memo(inserted), _tmpl$4()];
const firstComponent = [_$createComponent(Component, {}), _tmpl$4()];
const lastStatic = [_tmpl$4(), inserted];
const lastDynamic = [_tmpl$4(), _$memo(inserted)];
const lastComponent = [_tmpl$4(), _$createComponent(Component, {})];
const spaces = [_tmpl$5(), " ", _tmpl$6(), " ", _tmpl$7()];
const multiLineTrailing = _tmpl$8();
const groupedAroundExpression = [_tmpl$9(), inserted, _tmpl$0()];
const adjacentDynamicRoots = [
  (() => {
    var _el$21 = _tmpl$2();
    _$effect(
      () => state.first,
      _v$ => {
        _$setAttribute(_el$21, "id", _v$);
      }
    );
    return _el$21;
  })(),
  (() => {
    var _el$22 = _tmpl$3();
    _$effect(
      () => state.last,
      _v$ => {
        _$setAttribute(_el$22, "id", _v$);
      }
    );
    return _el$22;
  })()
];
const adjacentVoidRoots = _tmpl$1();
const adjacentImportRoots = _tmpl$10();
