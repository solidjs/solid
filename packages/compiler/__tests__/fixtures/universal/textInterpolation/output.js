import { createTextNode as _$createTextNode } from "r-custom";
import { insert as _$insert } from "r-custom";
import { insertNode as _$insertNode } from "r-custom";
import { createElement as _$createElement } from "r-custom";
var _el$ = _$createElement("span");
_$insertNode(_el$, _$createTextNode("Hello "));
const trailing = _el$;
var _el$2 = _$createElement("span");
_$insertNode(_el$2, _$createTextNode(" John"));
const leading = _el$2;
var _el$3 = _$createElement("span");
_$insertNode(_el$3, _$createTextNode("Hello John"));
/* prettier-ignore */
const extraSpaces = _el$3;
var _el$4 = _$createElement("span");
var _el$5 = _$createTextNode("Hello ");
_$insertNode(_el$4, _el$5);
_$insert(_el$4, name, null);
const trailingExpr = _el$4;
var _el$6 = _$createElement("span");
var _el$7 = _$createTextNode(" John");
_$insertNode(_el$6, _el$7);
_$insert(_el$6, greeting, _el$7);
const leadingExpr = _el$6;
var _el$8 = _$createElement("span");
var _el$9 = _$createTextNode(" ");
_$insertNode(_el$8, _el$9);
_$insert(_el$8, greeting, _el$9);
_$insert(_el$8, name, null);
/* prettier-ignore */
const multiExpr = _el$8;
var _el$10 = _$createElement("span");
var _el$11 = _$createTextNode(" ");
var _el$12 = _$createTextNode(" ");
var _el$13 = _$createTextNode(" ");
_$insertNode(_el$10, _el$11);
_$insertNode(_el$10, _el$12);
_$insertNode(_el$10, _el$13);
_$insert(_el$10, greeting, _el$12);
_$insert(_el$10, name, _el$13);
/* prettier-ignore */
const multiExprSpaced = _el$10;
var _el$14 = _$createElement("span");
var _el$15 = _$createTextNode(" ");
var _el$16 = _$createTextNode(" ");
_$insertNode(_el$14, _el$15);
_$insertNode(_el$14, _el$16);
_$insert(_el$14, greeting, _el$16);
_$insert(_el$14, name, _el$16);
/* prettier-ignore */
const multiExprTogether = _el$14;
var _el$17 = _$createElement("span");
_$insertNode(_el$17, _$createTextNode("Hello"));
/* prettier-ignore */
const multiLine = _el$17;
var _el$18 = _$createElement("span");
_$insertNode(_el$18, _$createTextNode("Hello John"));
/* prettier-ignore */
const multiLineTrailingSpace = _el$18;
var _el$19 = _$createElement("span");
_$insertNode(_el$19, _$createTextNode("Hello John"));
/* prettier-ignore */
const multiLineNoTrailingSpace = _el$19;
var _el$20 = _$createElement("span");
_$insertNode(_el$20, _$createTextNode("&nbsp;&lt;Hi&gt;&nbsp;"));
/* prettier-ignore */
const escape = _el$20;
var _el$21 = _$createElement("span");
var _el$22 = _$createTextNode("Hi&lt;script>alert();&lt;/script>");
_$insertNode(_el$21, _el$22);
/* prettier-ignore */
const injection = _el$21;
let value = "World";
var _el$23 = _$createElement("span");
var _el$24 = _$createTextNode("Hello World!");
_$insertNode(_el$23, _el$24);
const evaluated = _el$23;
let number = 4 + 5;
var _el$25 = _$createElement("span");
var _el$26 = _$createTextNode("4 + 5 = 9");
_$insertNode(_el$25, _el$26);
const evaluatedNonString = _el$25;
var _el$27 = _$createElement("div");
var _el$28 = _$createTextNode("\nd");
_$insertNode(_el$27, _el$28);
_$insert(_el$27, s, _el$28);
const newLineLiteral = _el$27;
var _el$29 = _$createElement("div");
_$insert(_el$29, expr);
const trailingSpace = _el$29;
var _el$30 = _$createElement("span");
var _el$31 = _$createTextNode(" ");
_$insertNode(_el$30, _el$31);
_$insert(_el$30, expr, null);
const leadingSpaceElement = _el$30;
var _el$32 = _$createElement("span");
var _el$33 = _$createTextNode(" ");
_$insertNode(_el$32, _el$33);
_$insert(_el$32, expr, _el$33);
const trailingSpaceElement = _el$32;
const escapeAttribute = _$createElement("div", {
	normal: "Search&hellip;",
	title: "Search&hellip;"
});
