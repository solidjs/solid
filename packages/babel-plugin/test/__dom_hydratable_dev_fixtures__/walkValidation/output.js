import { template as _$template } from "r-dom";
import { getNextSibling as _$getNextSibling } from "r-dom";
import { getNextElement as _$getNextElement } from "r-dom";
import { getFirstChild as _$getFirstChild } from "r-dom";
import { scope as _$scope } from "r-dom";
import { insert as _$insert } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(`<div><span>`),
  _tmpl$2 = /*#__PURE__*/ _$template(`<div><header>Title</header><main></main><footer>End`),
  _tmpl$3 = /*#__PURE__*/ _$template(`<span>Hello <b></b> world`),
  _tmpl$4 = /*#__PURE__*/ _$template(`<div><ul><li></li></ul><p>Static`);
const name = () => "dynamic";
var _el$ = _$getNextElement(_tmpl$),
  _el$2 = _$getFirstChild(_el$, "span");
_$insert(
  _el$2,
  _$scope(() => name())
);
const singleChild = _el$;
var _el$3 = _$getNextElement(_tmpl$2),
  _el$4 = _$getFirstChild(_el$3, "header"),
  _el$5 = _$getNextSibling(_el$4, "main");
_$insert(
  _el$5,
  _$scope(() => name())
);
const siblingElements = _el$3;
var _el$6 = _$getNextElement(_tmpl$3),
  _el$7 = _el$6.firstChild,
  _el$8 = _$getNextSibling(_el$7, "b");
_$insert(
  _el$8,
  _$scope(() => name())
);
const mixedTextAndElements = _el$6;
var _el$9 = _$getNextElement(_tmpl$4),
  _el$0 = _$getFirstChild(_el$9, "ul"),
  _el$1 = _$getFirstChild(_el$0, "li");
_$insert(
  _el$1,
  _$scope(() => name())
);
const nestedWalk = _el$9;
