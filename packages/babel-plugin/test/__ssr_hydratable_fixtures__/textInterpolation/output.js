import { ssrElement as _$ssrElement } from "r-server";
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
  _tmpl$16 = ["<div", ' normal="Search&#8230;" title="Search&amp;hellip;"></div>'],
  _tmpl$17 = ["<div", "><div></div><!--$-->", "<!--/--></div>"],
  _tmpl$18 = [
    "<p",
    ' title="Next &#8594;">Next &#8594; <style>.a::after{content:"\u2192"}</style></p>'
  ],
  _tmpl$19 = ["<style-guide", ">Next &#8594;</style-guide>"],
  _tmpl$20 = '.a::after{content:"\u2192"}',
  _tmpl$21 = ["<script", '>x = "</scripture>\u2192";</script>'],
  _tmpl$22 = ["<p", ' title="caf\xE9">caf\xE9 \x80\x91</p>'],
  _tmpl$23 = "\u2192",
  _tmpl$24 = ["<script", '>h = "<!--<script></script>\u2192";</script>'],
  _tmpl$25 = ["<svg", "><text><![CDATA[\u2192]]></text></svg>"],
  _tmpl$26 = "<span>\u2192</span>",
  _tmpl$27 = ["<div", '><style data-x=a\'b>.a::after{content:"\u2192"}</style></div>'],
  _tmpl$28 = ["<div", "><plaintext><p>\u2192</p></div>"];
var _sk$ = k => k === "title" || k === "data-static";
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
var _v$33 = _$ssrHydrationKey();
const nonAsciiText = _$ssr(_tmpl$18, _v$33);
const nonAsciiSpreadTail = _$ssrElement(
  "a",
  spread,
  undefined,
  true,
  _sk$,
  ' title="Next &#8594;" data-static="\xE9"'
);
var _v$34 = _$ssrHydrationKey();
const nonAsciiCustomElement = _$ssr(_tmpl$19, _v$34);
const nonAsciiSpreadStyle = _$ssrElement("style", spread, () => _$ssr(_tmpl$20), true);
var _v$35 = _$ssrHydrationKey();
const nonAsciiScriptture = _$ssr(_tmpl$21, _v$35);
var _v$36 = _$ssrHydrationKey();
const latin1AndC1 = _$ssr(_tmpl$22, _v$36);
const nonAsciiSpreadXmp = _$ssrElement("xmp", spread, () => _$ssr(_tmpl$23), true);
var _v$37 = _$ssrHydrationKey();
const nonAsciiEscapedScript = _$ssr(_tmpl$24, _v$37);
var _v$38 = _$ssrHydrationKey();
const nonAsciiCdata = _$ssr(_tmpl$25, _v$38);
const nonAsciiSpreadXmpElement = _$ssrElement("xmp", spread, () => _$ssr(_tmpl$26), true);
const nonAsciiSpreadScriptElement = _$ssrElement("script", spread, () => _$ssr(_tmpl$26), true);
var _v$39 = _$ssrHydrationKey();
const nonAsciiUnquotedQuote = _$ssr(_tmpl$27, _v$39);
var _v$40 = _$ssrHydrationKey();
const nonAsciiPlaintext = _$ssr(_tmpl$28, _v$40);
