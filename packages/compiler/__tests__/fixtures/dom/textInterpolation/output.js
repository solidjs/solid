import { template as _$template } from "r-dom";
import { insert as _$insert } from "r-dom";
import { createComponent as _$createComponent } from "r-dom";
var _tmpl$ = /* @__PURE__ */ _$template(`<span>Hello `);
var _tmpl$2 = /* @__PURE__ */ _$template(`<span> John`);
var _tmpl$3 = /* @__PURE__ */ _$template(`<span>Hello John`);
var _tmpl$4 = /* @__PURE__ */ _$template(`<span> <!>`);
var _tmpl$5 = /* @__PURE__ */ _$template(`<span> <!> <!> `);
var _tmpl$6 = /* @__PURE__ */ _$template(`<span> <!><!> `);
var _tmpl$7 = /* @__PURE__ */ _$template(`<span>Hello`);
var _tmpl$8 = /* @__PURE__ */ _$template(`<span>&nbsp;&lt;Hi&gt;&nbsp;`);
var _tmpl$9 = /* @__PURE__ */ _$template(`<span>Hi&lt;script>alert();&lt;/script>`);
var _tmpl$10 = /* @__PURE__ */ _$template(`<span>Hello World!`);
var _tmpl$11 = /* @__PURE__ */ _$template(`<span>4 + 5 = 9`);
var _tmpl$12 = /* @__PURE__ */ _$template(`<div>
d`);
var _tmpl$13 = /* @__PURE__ */ _$template(`<div>`);
var _tmpl$14 = /* @__PURE__ */ _$template(`<span> `);
var _tmpl$15 = /* @__PURE__ */ _$template(`<div normal=Search… title=Search&amp;hellip;>`);
var _tmpl$16 = /* @__PURE__ */ _$template(`<div><div>`);
var _tmpl$17 = /* @__PURE__ */ _$template(`<p>\${blah}`);
const trailing = _tmpl$();
const leading = _tmpl$2();
/* prettier-ignore */
const extraSpaces = _tmpl$3();
var _el$4 = _tmpl$();
var _el$5 = _el$4.firstChild;
_$insert(_el$4, name, null);
const trailingExpr = _el$4;
var _el$6 = _tmpl$2();
var _el$7 = _el$6.firstChild;
_$insert(_el$6, greeting, _el$6.firstChild);
const leadingExpr = _el$6;
var _el$8 = _tmpl$4();
var _el$9 = _el$8.firstChild;
var _el$10 = _el$9.nextSibling;
_$insert(_el$8, greeting, _el$8.firstChild);
_$insert(_el$8, name, _el$10);
/* prettier-ignore */
const multiExpr = _el$8;
var _el$11 = _tmpl$5();
var _el$12 = _el$11.firstChild;
var _el$13 = _el$12.nextSibling;
var _el$14 = _el$13.nextSibling;
var _el$15 = _el$14.nextSibling;
var _el$16 = _el$15.nextSibling;
_$insert(_el$11, greeting, _el$13);
_$insert(_el$11, name, _el$15);
/* prettier-ignore */
const multiExprSpaced = _el$11;
var _el$17 = _tmpl$6();
var _el$18 = _el$17.firstChild;
var _el$19 = _el$18.nextSibling;
var _el$20 = _el$19.nextSibling;
var _el$21 = _el$20.nextSibling;
_$insert(_el$17, greeting, _el$19);
_$insert(_el$17, name, _el$20);
/* prettier-ignore */
const multiExprTogether = _el$17;
/* prettier-ignore */
const multiLine = _tmpl$7();
/* prettier-ignore */
const multiLineTrailingSpace = _tmpl$3();
/* prettier-ignore */
const multiLineNoTrailingSpace = _tmpl$3();
/* prettier-ignore */
const escape = _tmpl$8();
/* prettier-ignore */
const escape2 = _$createComponent(Comp, { children: "\xA0<Hi>\xA0" });
/* prettier-ignore */
const escape3 = "\xA0<Hi>\xA0";
const injection = _tmpl$9();
let value = "World";
const evaluated = _tmpl$10();
let number = 4 + 5;
const evaluatedNonString = _tmpl$11();
var _el$29 = _tmpl$12();
var _el$30 = _el$29.firstChild;
_$insert(_el$29, s, _el$29.firstChild);
const newLineLiteral = _el$29;
var _el$31 = _tmpl$13();
_$insert(_el$31, expr);
const trailingSpace = _el$31;
const trailingSpaceComp = _$createComponent(Comp, { children: expr });
const trailingSpaceFrag = expr;
var _el$32 = _tmpl$14();
var _el$33 = _el$32.firstChild;
_$insert(_el$32, expr, null);
const leadingSpaceElement = _el$32;
const leadingSpaceComponent = _$createComponent(Div, { get children() {
	return [" ", expr];
} });
const leadingSpaceFragment = [" ", expr];
var _el$34 = _tmpl$14();
var _el$35 = _el$34.firstChild;
_$insert(_el$34, expr, _el$34.firstChild);
const trailingSpaceElement = _el$34;
const trailingSpaceComponent = _$createComponent(Div, { get children() {
	return [expr, " "];
} });
const trailingSpaceFragment = [expr, " "];
const escapeAttribute = _tmpl$15();
const escapeCompAttribute = _$createComponent(Div, {
	normal: "Search…",
	title: "Search&hellip;"
});
var _el$37 = _tmpl$16();
var _el$38 = _el$37.firstChild;
_$insert(_el$37, expr, null);
const lastElementExpression = _el$37;
const messwithTemplates = _tmpl$17();
