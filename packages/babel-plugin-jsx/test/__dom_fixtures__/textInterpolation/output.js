import { template as _$template } from "r-dom";
import { createComponent as _$createComponent } from "r-dom";
import { insert as _$insert } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(`<span>Hello `),
  _tmpl$2 = /*#__PURE__*/ _$template(`<span> John`),
  _tmpl$3 = /*#__PURE__*/ _$template(`<span>Hello John`),
  _tmpl$4 = /*#__PURE__*/ _$template(`<span> <!>`),
  _tmpl$5 = /*#__PURE__*/ _$template(`<span> <!> <!> `),
  _tmpl$6 = /*#__PURE__*/ _$template(`<span> <!><!> `),
  _tmpl$7 = /*#__PURE__*/ _$template(`<span>Hello`),
  _tmpl$8 = /*#__PURE__*/ _$template(`<span>&nbsp;&lt;Hi&gt;&nbsp;`),
  _tmpl$9 = /*#__PURE__*/ _$template(`<span>Hi&lt;script>alert();&lt;/script>`),
  _tmpl$0 = /*#__PURE__*/ _$template(`<span>Hello World!`),
  _tmpl$1 = /*#__PURE__*/ _$template(`<span>4 + 5 = 9`),
  _tmpl$10 = /*#__PURE__*/ _$template(`<div>\nd`),
  _tmpl$11 = /*#__PURE__*/ _$template(`<div>`),
  _tmpl$12 = /*#__PURE__*/ _$template(`<span> `),
  _tmpl$13 = /*#__PURE__*/ _$template(`<div normal=Search… title=Search&amp;hellip;>`),
  _tmpl$14 = /*#__PURE__*/ _$template(`<div><div>`),
  _tmpl$15 = /*#__PURE__*/ _$template(`<p>$\{blah}`);
const trailing = _tmpl$();
const leading = _tmpl$2();

/* prettier-ignore */
const extraSpaces = _tmpl$3();
var _el$4 = _tmpl$(),
  _el$5 = _el$4.firstChild;
_$insert(_el$4, name, null);
const trailingExpr = _el$4;
var _el$6 = _tmpl$2(),
  _el$7 = _el$6.firstChild;
_$insert(_el$6, greeting, _el$7);
const leadingExpr = _el$6;

/* prettier-ignore */
var _el$8 = _tmpl$4(),
  _el$9 = _el$8.firstChild,
  _el$0 = _el$9.nextSibling;
_$insert(_el$8, greeting, _el$9);
_$insert(_el$8, name, _el$0);
const multiExpr = _el$8;

/* prettier-ignore */
var _el$1 = _tmpl$5(),
  _el$10 = _el$1.firstChild,
  _el$13 = _el$10.nextSibling,
  _el$11 = _el$13.nextSibling,
  _el$14 = _el$11.nextSibling,
  _el$12 = _el$14.nextSibling;
_$insert(_el$1, greeting, _el$13);
_$insert(_el$1, name, _el$14);
const multiExprSpaced = _el$1;

/* prettier-ignore */
var _el$15 = _tmpl$6(),
  _el$16 = _el$15.firstChild,
  _el$18 = _el$16.nextSibling,
  _el$19 = _el$18.nextSibling,
  _el$17 = _el$19.nextSibling;
_$insert(_el$15, greeting, _el$18);
_$insert(_el$15, name, _el$19);
const multiExprTogether = _el$15;

/* prettier-ignore */
const multiLine = _tmpl$7();

/* prettier-ignore */
const multiLineTrailingSpace = _tmpl$3();

/* prettier-ignore */
const multiLineNoTrailingSpace = _tmpl$3();

/* prettier-ignore */
const escape = _tmpl$8();

/* prettier-ignore */
const escape2 = _$createComponent(Comp, {
  children: "\xA0<Hi>\xA0"
});

/* prettier-ignore */
const escape3 = "\xA0<Hi>\xA0";
const injection = _tmpl$9();
let value = "World";
const evaluated = _tmpl$0();
let number = 4 + 5;
const evaluatedNonString = _tmpl$1();
var _el$27 = _tmpl$10(),
  _el$28 = _el$27.firstChild;
_$insert(_el$27, s, _el$28);
const newLineLiteral = _el$27;
var _el$29 = _tmpl$11();
_$insert(_el$29, expr);
const trailingSpace = _el$29;
const trailingSpaceComp = _$createComponent(Comp, {
  children: expr
});
const trailingSpaceFrag = expr;
var _el$30 = _tmpl$12(),
  _el$31 = _el$30.firstChild;
_$insert(_el$30, expr, null);
const leadingSpaceElement = _el$30;
const leadingSpaceComponent = _$createComponent(Div, {
  get children() {
    return [" ", expr];
  }
});
const leadingSpaceFragment = [" ", expr];
var _el$32 = _tmpl$12(),
  _el$33 = _el$32.firstChild;
_$insert(_el$32, expr, _el$33);
const trailingSpaceElement = _el$32;
const trailingSpaceComponent = _$createComponent(Div, {
  get children() {
    return [expr, " "];
  }
});
const trailingSpaceFragment = [expr, " "];
const escapeAttribute = _tmpl$13();
const escapeCompAttribute = _$createComponent(Div, {
  normal: "Search\u2026",
  title: "Search&hellip;"
});
var _el$35 = _tmpl$14(),
  _el$36 = _el$35.firstChild;
_$insert(_el$35, expr, null);
const lastElementExpression = _el$35;
const messwithTemplates = _tmpl$15();
