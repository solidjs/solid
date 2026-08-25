import { template as _$template } from "r-dom";
import { getNextElement as _$getNextElement } from "r-dom";
import { getNextMarker as _$getNextMarker } from "r-dom";
import { insert as _$insert } from "r-dom";
import { scope as _$scope } from "r-dom";
import { createComponent as _$createComponent } from "r-dom";
var _tmpl$ = /* @__PURE__ */ _$template(`<span>Hello `);
var _tmpl$2 = /* @__PURE__ */ _$template(`<span> John`);
var _tmpl$3 = /* @__PURE__ */ _$template(`<span>Hello John`);
var _tmpl$4 = /* @__PURE__ */ _$template(`<span>Hello <!$><!/>`);
var _tmpl$5 = /* @__PURE__ */ _$template(`<span><!$><!/> John`);
var _tmpl$6 = /* @__PURE__ */ _$template(`<span><!$><!/> <!$><!/>`);
var _tmpl$7 = /* @__PURE__ */ _$template(`<span> <!$><!/> <!$><!/> `);
var _tmpl$8 = /* @__PURE__ */ _$template(`<span> <!$><!/><!$><!/> `);
var _tmpl$9 = /* @__PURE__ */ _$template(`<span>Hello`);
var _tmpl$10 = /* @__PURE__ */ _$template(`<span>&nbsp;&lt;Hi&gt;&nbsp;`);
var _tmpl$11 = /* @__PURE__ */ _$template(`<span>Hi&lt;script>alert();&lt;/script>`);
var _tmpl$12 = /* @__PURE__ */ _$template(`<span>Hello World!`);
var _tmpl$13 = /* @__PURE__ */ _$template(`<span>4 + 5 = 9`);
var _tmpl$14 = /* @__PURE__ */ _$template(`<div><!$><!/>
d`);
var _tmpl$15 = /* @__PURE__ */ _$template(`<div>`);
var _tmpl$16 = /* @__PURE__ */ _$template(`<span> <!$><!/>`);
var _tmpl$17 = /* @__PURE__ */ _$template(`<span><!$><!/> `);
var _tmpl$18 = /* @__PURE__ */ _$template(`<div normal=Search… title=Search&amp;hellip;>`);
var _tmpl$19 = /* @__PURE__ */ _$template(`<div><div></div><!$><!/>`);
const trailing = _$getNextElement(_tmpl$);
const leading = _$getNextElement(_tmpl$2);
/* prettier-ignore */
const extraSpaces = _$getNextElement(_tmpl$3);
var _el$4 = _$getNextElement(_tmpl$4);
var _el$5 = _el$4.firstChild;
var _el$6 = _el$5.nextSibling;
var [_el$7, _el$8] = _$getNextMarker(_el$6.nextSibling);
_$insert(_el$4, name, _el$7, _el$8);
const trailingExpr = _el$4;
var _el$9 = _$getNextElement(_tmpl$5);
var _el$10 = _el$9.firstChild;
var [_el$11, _el$12] = _$getNextMarker(_el$10.nextSibling);
var _el$13 = _el$11.nextSibling;
_$insert(_el$9, greeting, _el$11, _el$12);
const leadingExpr = _el$9;
var _el$14 = _$getNextElement(_tmpl$6);
var _el$15 = _el$14.firstChild;
var [_el$16, _el$17] = _$getNextMarker(_el$15.nextSibling);
var _el$18 = _el$16.nextSibling;
var _el$19 = _el$18.nextSibling;
var [_el$20, _el$21] = _$getNextMarker(_el$19.nextSibling);
_$insert(_el$14, greeting, _el$16, _el$17);
_$insert(_el$14, name, _el$20, _el$21);
/* prettier-ignore */
const multiExpr = _el$14;
var _el$22 = _$getNextElement(_tmpl$7);
var _el$23 = _el$22.firstChild;
var _el$24 = _el$23.nextSibling;
var [_el$25, _el$26] = _$getNextMarker(_el$24.nextSibling);
var _el$27 = _el$25.nextSibling;
var _el$28 = _el$27.nextSibling;
var [_el$29, _el$30] = _$getNextMarker(_el$28.nextSibling);
var _el$31 = _el$29.nextSibling;
_$insert(_el$22, greeting, _el$25, _el$26);
_$insert(_el$22, name, _el$29, _el$30);
/* prettier-ignore */
const multiExprSpaced = _el$22;
var _el$32 = _$getNextElement(_tmpl$8);
var _el$33 = _el$32.firstChild;
var _el$34 = _el$33.nextSibling;
var [_el$35, _el$36] = _$getNextMarker(_el$34.nextSibling);
var _el$37 = _el$35.nextSibling;
var [_el$38, _el$39] = _$getNextMarker(_el$37.nextSibling);
var _el$40 = _el$38.nextSibling;
_$insert(_el$32, greeting, _el$35, _el$36);
_$insert(_el$32, name, _el$38, _el$39);
/* prettier-ignore */
const multiExprTogether = _el$32;
/* prettier-ignore */
const multiLine = _$getNextElement(_tmpl$9);
/* prettier-ignore */
const multiLineTrailingSpace = _$getNextElement(_tmpl$3);
/* prettier-ignore */
const multiLineNoTrailingSpace = _$getNextElement(_tmpl$3);
/* prettier-ignore */
const escape = _$getNextElement(_tmpl$10);
/* prettier-ignore */
const escape2 = _$createComponent(Comp, { children: "\xA0<Hi>\xA0" });
/* prettier-ignore */
const escape3 = "\xA0<Hi>\xA0";
const injection = _$getNextElement(_tmpl$11);
let value = "World";
const evaluated = _$getNextElement(_tmpl$12);
let number = 4 + 5;
const evaluatedNonString = _$getNextElement(_tmpl$13);
var _el$48 = _$getNextElement(_tmpl$14);
var _el$49 = _el$48.firstChild;
var [_el$50, _el$51] = _$getNextMarker(_el$49.nextSibling);
var _el$52 = _el$50.nextSibling;
_$insert(_el$48, s, _el$50, _el$51);
const newLineLiteral = _el$48;
var _el$53 = _$getNextElement(_tmpl$15);
_$insert(_el$53, expr);
const trailingSpace = _el$53;
const trailingSpaceComp = _$createComponent(Comp, { children: expr });
const trailingSpaceFrag = expr;
var _el$54 = _$getNextElement(_tmpl$16);
var _el$55 = _el$54.firstChild;
var _el$56 = _el$55.nextSibling;
var [_el$57, _el$58] = _$getNextMarker(_el$56.nextSibling);
_$insert(_el$54, expr, _el$57, _el$58);
const leadingSpaceElement = _el$54;
const leadingSpaceComponent = _$createComponent(Div, { get children() {
	return [" ", expr];
} });
const leadingSpaceFragment = [" ", expr];
var _el$59 = _$getNextElement(_tmpl$17);
var _el$60 = _el$59.firstChild;
var [_el$61, _el$62] = _$getNextMarker(_el$60.nextSibling);
var _el$63 = _el$61.nextSibling;
_$insert(_el$59, expr, _el$61, _el$62);
const trailingSpaceElement = _el$59;
const trailingSpaceComponent = _$createComponent(Div, { get children() {
	return [expr, " "];
} });
const trailingSpaceFragment = [expr, " "];
const escapeAttribute = _$getNextElement(_tmpl$18);
const escapeCompAttribute = _$createComponent(Div, {
	normal: "Search…",
	title: "Search&hellip;"
});
var _el$65 = _$getNextElement(_tmpl$19);
var _el$66 = _el$65.firstChild;
var _el$67 = _el$66.nextSibling;
var [_el$68, _el$69] = _$getNextMarker(_el$67.nextSibling);
_$insert(_el$65, _$scope(() => {
	return expr();
}), _el$68, _el$69);
const lastElementExpression = _el$65;
