import { template as _$template } from "r-dom";
import { scope as _$scope } from "r-dom";
import { createComponent as _$createComponent } from "r-dom";
import { getNextMarker as _$getNextMarker } from "r-dom";
import { insert as _$insert } from "r-dom";
import { getNextElement as _$getNextElement } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(`<span>Hello `),
  _tmpl$2 = /*#__PURE__*/ _$template(`<span> John`),
  _tmpl$3 = /*#__PURE__*/ _$template(`<span>Hello John`),
  _tmpl$4 = /*#__PURE__*/ _$template(`<span>Hello <!$><!/>`),
  _tmpl$5 = /*#__PURE__*/ _$template(`<span><!$><!/> John`),
  _tmpl$6 = /*#__PURE__*/ _$template(`<span><!$><!/> <!$><!/>`),
  _tmpl$7 = /*#__PURE__*/ _$template(`<span> <!$><!/> <!$><!/> `),
  _tmpl$8 = /*#__PURE__*/ _$template(`<span> <!$><!/><!$><!/> `),
  _tmpl$9 = /*#__PURE__*/ _$template(`<span>Hello`),
  _tmpl$0 = /*#__PURE__*/ _$template(`<span>&nbsp;&lt;Hi&gt;&nbsp;`),
  _tmpl$1 = /*#__PURE__*/ _$template(`<span>Hi&lt;script>alert();&lt;/script>`),
  _tmpl$10 = /*#__PURE__*/ _$template(`<span>Hello World!`),
  _tmpl$11 = /*#__PURE__*/ _$template(`<span>4 + 5 = 9`),
  _tmpl$12 = /*#__PURE__*/ _$template(`<div><!$><!/>\nd`),
  _tmpl$13 = /*#__PURE__*/ _$template(`<div>`),
  _tmpl$14 = /*#__PURE__*/ _$template(`<span> <!$><!/>`),
  _tmpl$15 = /*#__PURE__*/ _$template(`<span><!$><!/> `),
  _tmpl$16 = /*#__PURE__*/ _$template(`<div normal=Search… title=Search&amp;hellip;>`),
  _tmpl$17 = /*#__PURE__*/ _$template(`<div><div></div><!$><!/>`);
const trailing = _$getNextElement(_tmpl$);
const leading = _$getNextElement(_tmpl$2);

/* prettier-ignore */
const extraSpaces = _$getNextElement(_tmpl$3);
var _el$4 = _$getNextElement(_tmpl$4),
  _el$5 = _el$4.firstChild,
  _el$6 = _el$5.nextSibling,
  [_el$7, _co$] = _$getNextMarker(_el$6.nextSibling);
_$insert(_el$4, name, _el$7, _co$);
const trailingExpr = _el$4;
var _el$8 = _$getNextElement(_tmpl$5),
  _el$0 = _el$8.firstChild,
  [_el$1, _co$2] = _$getNextMarker(_el$0.nextSibling),
  _el$9 = _el$1.nextSibling;
_$insert(_el$8, greeting, _el$1, _co$2);
const leadingExpr = _el$8;

/* prettier-ignore */
var _el$10 = _$getNextElement(_tmpl$6),
  _el$12 = _el$10.firstChild,
  [_el$13, _co$3] = _$getNextMarker(_el$12.nextSibling),
  _el$11 = _el$13.nextSibling,
  _el$14 = _el$11.nextSibling,
  [_el$15, _co$4] = _$getNextMarker(_el$14.nextSibling);
_$insert(_el$10, greeting, _el$13, _co$3);
_$insert(_el$10, name, _el$15, _co$4);
const multiExpr = _el$10;

/* prettier-ignore */
var _el$16 = _$getNextElement(_tmpl$7),
  _el$17 = _el$16.firstChild,
  _el$20 = _el$17.nextSibling,
  [_el$21, _co$5] = _$getNextMarker(_el$20.nextSibling),
  _el$18 = _el$21.nextSibling,
  _el$22 = _el$18.nextSibling,
  [_el$23, _co$6] = _$getNextMarker(_el$22.nextSibling),
  _el$19 = _el$23.nextSibling;
_$insert(_el$16, greeting, _el$21, _co$5);
_$insert(_el$16, name, _el$23, _co$6);
const multiExprSpaced = _el$16;

/* prettier-ignore */
var _el$24 = _$getNextElement(_tmpl$8),
  _el$25 = _el$24.firstChild,
  _el$27 = _el$25.nextSibling,
  [_el$28, _co$7] = _$getNextMarker(_el$27.nextSibling),
  _el$29 = _el$28.nextSibling,
  [_el$30, _co$8] = _$getNextMarker(_el$29.nextSibling),
  _el$26 = _el$30.nextSibling;
_$insert(_el$24, greeting, _el$28, _co$7);
_$insert(_el$24, name, _el$30, _co$8);
const multiExprTogether = _el$24;

/* prettier-ignore */
const multiLine = _$getNextElement(_tmpl$9);

/* prettier-ignore */
const multiLineTrailingSpace = _$getNextElement(_tmpl$3);

/* prettier-ignore */
const multiLineNoTrailingSpace = _$getNextElement(_tmpl$3);

/* prettier-ignore */
const escape = _$getNextElement(_tmpl$0);

/* prettier-ignore */
const escape2 = _$createComponent(Comp, {
  children: "\xA0<Hi>\xA0"
});

/* prettier-ignore */
const escape3 = "\xA0<Hi>\xA0";
const injection = _$getNextElement(_tmpl$1);
let value = "World";
const evaluated = _$getNextElement(_tmpl$10);
let number = 4 + 5;
const evaluatedNonString = _$getNextElement(_tmpl$11);
var _el$38 = _$getNextElement(_tmpl$12),
  _el$40 = _el$38.firstChild,
  [_el$41, _co$9] = _$getNextMarker(_el$40.nextSibling),
  _el$39 = _el$41.nextSibling;
_$insert(_el$38, s, _el$41, _co$9);
const newLineLiteral = _el$38;
var _el$42 = _$getNextElement(_tmpl$13);
_$insert(_el$42, expr);
const trailingSpace = _el$42;
const trailingSpaceComp = _$createComponent(Comp, {
  children: expr
});
const trailingSpaceFrag = expr;
var _el$43 = _$getNextElement(_tmpl$14),
  _el$44 = _el$43.firstChild,
  _el$45 = _el$44.nextSibling,
  [_el$46, _co$0] = _$getNextMarker(_el$45.nextSibling);
_$insert(_el$43, expr, _el$46, _co$0);
const leadingSpaceElement = _el$43;
const leadingSpaceComponent = _$createComponent(Div, {
  get children() {
    return [" ", expr];
  }
});
const leadingSpaceFragment = [" ", expr];
var _el$47 = _$getNextElement(_tmpl$15),
  _el$49 = _el$47.firstChild,
  [_el$50, _co$1] = _$getNextMarker(_el$49.nextSibling),
  _el$48 = _el$50.nextSibling;
_$insert(_el$47, expr, _el$50, _co$1);
const trailingSpaceElement = _el$47;
const trailingSpaceComponent = _$createComponent(Div, {
  get children() {
    return [expr, " "];
  }
});
const trailingSpaceFragment = [expr, " "];
const escapeAttribute = _$getNextElement(_tmpl$16);
const escapeCompAttribute = _$createComponent(Div, {
  normal: "Search\u2026",
  title: "Search&hellip;"
});
var _el$52 = _$getNextElement(_tmpl$17),
  _el$53 = _el$52.firstChild,
  _el$54 = _el$53.nextSibling,
  [_el$55, _co$10] = _$getNextMarker(_el$54.nextSibling);
_$insert(
  _el$52,
  _$scope(() => expr()),
  _el$55,
  _co$10
);
const lastElementExpression = _el$52;
