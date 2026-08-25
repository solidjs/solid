import { scope as _$scope } from "r-server";
import { escape as _$escape } from "r-server";
import { ssr as _$ssr } from "r-server";
import { ssrHydrationKey as _$ssrHydrationKey } from "r-server";
var _tmpl$ = ["<span", ">Hello </span>"],
  _tmpl$2 = ["<span", "> John</span>"],
  _tmpl$3 = ["<span", ">Hello John</span>"],
  _tmpl$4 = ["<span", ">Hello <!--$-->", "<!--/--></span>"],
  _tmpl$5 = ["<span", "><!--$-->", "<!--/--> John</span>"],
  _tmpl$6 = ["<span", "><!--$-->", "<!--/--> <!--$-->", "<!--/--></span>"],
  _tmpl$7 = ["<span", "> <!--$-->", "<!--/--> <!--$-->", "<!--/--> </span>"],
  _tmpl$8 = ["<span", "> <!--$-->", "<!--/--><!--$-->", "<!--/--> </span>"],
  _tmpl$9 = ["<span", ">Hello</span>"],
  _tmpl$0 = ["<span", ">&nbsp;&lt;Hi&gt;&nbsp;</span>"],
  _tmpl$1 = ["<span", ">Hi&lt;script>alert();&lt;/script></span>"],
  _tmpl$10 = ["<span", ">Hello World!</span>"],
  _tmpl$11 = ["<span", ">4 + 5 = 9</span>"],
  _tmpl$12 = ["<div", "><!--$-->", "<!--/-->\nd</div>"],
  _tmpl$13 = ["<div", ">", "</div>"],
  _tmpl$14 = ["<span", "> <!--$-->", "<!--/--></span>"],
  _tmpl$15 = ["<span", "><!--$-->", "<!--/--> </span>"],
  _tmpl$16 = ["<div", ' normal="Search\u2026" title="Search&amp;hellip;"></div>'],
  _tmpl$17 = ["<div", "><div></div><!--$-->", "<!--/--></div>"];
var _v$ = _$ssrHydrationKey();
const trailing = _$ssr(_tmpl$, _v$);
var _v$2 = _$ssrHydrationKey();
const leading = _$ssr(_tmpl$2, _v$2);

/* prettier-ignore */
var _v$3 = _$ssrHydrationKey();
const extraSpaces = _$ssr(_tmpl$3, _v$3);
var _v$4 = _$ssrHydrationKey(),
  _v$5 = _$escape(name);
const trailingExpr = _$ssr(_tmpl$4, _v$4, _v$5);
var _v$6 = _$ssrHydrationKey(),
  _v$7 = _$escape(greeting);
const leadingExpr = _$ssr(_tmpl$5, _v$6, _v$7);

/* prettier-ignore */
var _v$8 = _$ssrHydrationKey(),
  _v$9 = _$escape(greeting),
  _v$0 = _$escape(name);
const multiExpr = _$ssr(_tmpl$6, _v$8, _v$9, _v$0);

/* prettier-ignore */
var _v$1 = _$ssrHydrationKey(),
  _v$10 = _$escape(greeting),
  _v$11 = _$escape(name);
const multiExprSpaced = _$ssr(_tmpl$7, _v$1, _v$10, _v$11);

/* prettier-ignore */
var _v$12 = _$ssrHydrationKey(),
  _v$13 = _$escape(greeting),
  _v$14 = _$escape(name);
const multiExprTogether = _$ssr(_tmpl$8, _v$12, _v$13, _v$14);

/* prettier-ignore */
var _v$15 = _$ssrHydrationKey();
const multiLine = _$ssr(_tmpl$9, _v$15);

/* prettier-ignore */
var _v$16 = _$ssrHydrationKey();
const multiLineTrailingSpace = _$ssr(_tmpl$3, _v$16);

/* prettier-ignore */
var _v$17 = _$ssrHydrationKey();
const multiLineNoTrailingSpace = _$ssr(_tmpl$3, _v$17);

/* prettier-ignore */
var _v$18 = _$ssrHydrationKey();
const escape = _$ssr(_tmpl$0, _v$18);

/* prettier-ignore */
const escape2 = Comp({
  children: "\xA0<Hi>\xA0"
});

/* prettier-ignore */
const escape3 = "\xA0<Hi>\xA0";
var _v$19 = _$ssrHydrationKey();
const injection = _$ssr(_tmpl$1, _v$19);
let value = "World";
var _v$20 = _$ssrHydrationKey();
const evaluated = _$ssr(_tmpl$10, _v$20);
let number = 4 + 5;
var _v$21 = _$ssrHydrationKey();
const evaluatedNonString = _$ssr(_tmpl$11, _v$21);
var _v$22 = _$ssrHydrationKey(),
  _v$23 = _$escape(s);
const newLineLiteral = _$ssr(_tmpl$12, _v$22, _v$23);
var _v$24 = _$ssrHydrationKey(),
  _v$25 = _$escape(expr);
const trailingSpace = _$ssr(_tmpl$13, _v$24, _v$25);
const trailingSpaceComp = Comp({
  children: expr
});
const trailingSpaceFrag = expr;
var _v$26 = _$ssrHydrationKey(),
  _v$27 = _$escape(expr);
const leadingSpaceElement = _$ssr(_tmpl$14, _v$26, _v$27);
const leadingSpaceComponent = Div({
  get children() {
    return [" ", expr];
  }
});
const leadingSpaceFragment = [" ", expr];
var _v$28 = _$ssrHydrationKey(),
  _v$29 = _$escape(expr);
const trailingSpaceElement = _$ssr(_tmpl$15, _v$28, _v$29);
const trailingSpaceComponent = Div({
  get children() {
    return [expr, " "];
  }
});
const trailingSpaceFragment = [expr, " "];
var _v$30 = _$ssrHydrationKey();
const escapeAttribute = _$ssr(_tmpl$16, _v$30);
const escapeCompAttribute = Div({
  normal: "Search\u2026",
  title: "Search&hellip;"
});
var _v$31 = _$ssrHydrationKey(),
  _v$32 = _$scope(() => _$escape(expr()));
const lastElementExpression = _$ssr(_tmpl$17, _v$31, _v$32);
