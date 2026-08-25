import { escape as _$escape } from "r-server";
import { ssr as _$ssr } from "r-server";
var _tmpl$ = "<span>Hello </span>";
var _tmpl$2 = "<span> John</span>";
var _tmpl$3 = "<span>Hello John</span>";
var _tmpl$4 = ["<span>Hello ", "</span>"];
var _tmpl$5 = ["<span>", " John</span>"];
var _tmpl$6 = [
	"<span>",
	" ",
	"</span>"
];
var _tmpl$7 = [
	"<span> ",
	" ",
	" </span>"
];
var _tmpl$8 = [
	"<span> ",
	"",
	" </span>"
];
var _tmpl$9 = "<span>Hello</span>";
var _tmpl$10 = "<span>&nbsp;&lt;Hi&gt;&nbsp;</span>";
var _tmpl$11 = "<span>Hi&lt;script>alert();&lt;/script></span>";
var _tmpl$12 = "<span>Hello World!</span>";
var _tmpl$13 = "<span>4 + 5 = 9</span>";
var _tmpl$14 = ["<div>", "\nd</div>"];
var _tmpl$15 = ["<div>", "</div>"];
var _tmpl$16 = ["<span> ", "</span>"];
var _tmpl$17 = ["<span>", " </span>"];
var _tmpl$18 = "<div normal=\"Search…\" title=\"Search&amp;hellip;\"></div>";
var _tmpl$19 = ["<div><div></div>", "</div>"];
var _tmpl$20 = "<p>${blah}</p>";
const trailing = _$ssr(_tmpl$);
const leading = _$ssr(_tmpl$2);
/* prettier-ignore */
const extraSpaces = _$ssr(_tmpl$3);
var _v$ = _$escape(name);
const trailingExpr = _$ssr(_tmpl$4, _v$);
var _v$2 = _$escape(greeting);
const leadingExpr = _$ssr(_tmpl$5, _v$2);
var _v$3 = _$escape(greeting), _v$4 = _$escape(name);
/* prettier-ignore */
const multiExpr = _$ssr(_tmpl$6, _v$3, _v$4);
var _v$5 = _$escape(greeting), _v$6 = _$escape(name);
/* prettier-ignore */
const multiExprSpaced = _$ssr(_tmpl$7, _v$5, _v$6);
var _v$7 = _$escape(greeting), _v$8 = _$escape(name);
/* prettier-ignore */
const multiExprTogether = _$ssr(_tmpl$8, _v$7, _v$8);
/* prettier-ignore */
const multiLine = _$ssr(_tmpl$9);
/* prettier-ignore */
const multiLineTrailingSpace = _$ssr(_tmpl$3);
/* prettier-ignore */
const multiLineNoTrailingSpace = _$ssr(_tmpl$3);
/* prettier-ignore */
const escape = _$ssr(_tmpl$10);
/* prettier-ignore */
const injection = _$ssr(_tmpl$11);
let value = "World";
const evaluated = _$ssr(_tmpl$12);
let number = 4 + 5;
const evaluatedNonString = _$ssr(_tmpl$13);
var _v$9 = _$escape(s);
const newLineLiteral = _$ssr(_tmpl$14, _v$9);
var _v$10 = _$escape(expr);
const trailingSpace = _$ssr(_tmpl$15, _v$10);
var _v$11 = _$escape(expr);
const leadingSpaceElement = _$ssr(_tmpl$16, _v$11);
var _v$12 = _$escape(expr);
const trailingSpaceElement = _$ssr(_tmpl$17, _v$12);
const escapeAttribute = _$ssr(_tmpl$18);
var _v$13 = () => {
	return _$escape(expr());
};
const lastElementExpression = _$ssr(_tmpl$19, _v$13);
const messwithTemplates = _$ssr(_tmpl$20);
