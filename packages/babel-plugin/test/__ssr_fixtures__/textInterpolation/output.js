import { ssrElement as _$ssrElement } from "r-server";
import { escape as _$escape } from "r-server";
import { ssr as _$ssr } from "r-server";
var _tmpl$ = "<span>Hello </span>",
  _tmpl$2 = "<span> John</span>",
  _tmpl$3 = "<span>Hello John</span>",
  _tmpl$4 = ["<span>Hello ", "</span>"],
  _tmpl$5 = ["<span>", " John</span>"],
  _tmpl$6 = ["<span>", " ", "</span>"],
  _tmpl$7 = ["<span> ", " ", " </span>"],
  _tmpl$8 = ["<span> ", "", " </span>"],
  _tmpl$9 = "<span>Hello</span>",
  _tmpl$0 = "<span>&nbsp;&lt;Hi&gt;&nbsp;</span>",
  _tmpl$1 = "<span>Hi&lt;script>alert();&lt;/script></span>",
  _tmpl$10 = "<span>Hello World!</span>",
  _tmpl$11 = "<span>4 + 5 = 9</span>",
  _tmpl$12 = ["<div>", "\nd</div>"],
  _tmpl$13 = ["<div>", "</div>"],
  _tmpl$14 = ["<span> ", "</span>"],
  _tmpl$15 = ["<span>", " </span>"],
  _tmpl$16 = '<div normal="Search&#8230;" title="Search&amp;hellip;"></div>',
  _tmpl$17 = ["<div><div></div>", "</div>"],
  _tmpl$18 = "<p>${blah}</p>",
  _tmpl$19 = '<p title="Next &#8594;">Next &#8594; <style>.a::after{content:"\u2192"}</style></p>',
  _tmpl$20 = "<style-guide>Next &#8594;</style-guide>",
  _tmpl$21 = '.a::after{content:"\u2192"}',
  _tmpl$22 = '<script>x = "</scripture>\u2192";</script>',
  _tmpl$23 = '<p title="caf\xE9">caf\xE9 \x80\x91</p>',
  _tmpl$24 = "\u2192",
  _tmpl$25 = '<script>h = "<!--<script></script>\u2192";</script>',
  _tmpl$26 = "<svg><text><![CDATA[\u2192]]></text></svg>",
  _tmpl$27 = "<span>\u2192</span>",
  _tmpl$28 = '<div><style data-x=a\'b>.a::after{content:"\u2192"}</style></div>',
  _tmpl$29 = "<div><plaintext><p>\u2192</p></div>";
var _sk$ = k => k === "title" || k === "data-static";
const trailing = _$ssr(_tmpl$);
const leading = _$ssr(_tmpl$2);

/* prettier-ignore */
const extraSpaces = _$ssr(_tmpl$3);
var _v$ = _$escape(name);
const trailingExpr = _$ssr(_tmpl$4, _v$);
var _v$2 = _$escape(greeting);
const leadingExpr = _$ssr(_tmpl$5, _v$2);

/* prettier-ignore */
var _v$3 = _$escape(greeting),
  _v$4 = _$escape(name);
const multiExpr = _$ssr(_tmpl$6, _v$3, _v$4);

/* prettier-ignore */
var _v$5 = _$escape(greeting),
  _v$6 = _$escape(name);
const multiExprSpaced = _$ssr(_tmpl$7, _v$5, _v$6);

/* prettier-ignore */
var _v$7 = _$escape(greeting),
  _v$8 = _$escape(name);
const multiExprTogether = _$ssr(_tmpl$8, _v$7, _v$8);

/* prettier-ignore */
const multiLine = _$ssr(_tmpl$9);

/* prettier-ignore */
const multiLineTrailingSpace = _$ssr(_tmpl$3);

/* prettier-ignore */
const multiLineNoTrailingSpace = _$ssr(_tmpl$3);

/* prettier-ignore */
const escape = _$ssr(_tmpl$0);

/* prettier-ignore */
const escape2 = Comp({
  children: "\xA0<Hi>\xA0"
});

/* prettier-ignore */
const escape3 = "\xA0<Hi>\xA0";
const injection = _$ssr(_tmpl$1);
let value = "World";
const evaluated = _$ssr(_tmpl$10);
let number = 4 + 5;
const evaluatedNonString = _$ssr(_tmpl$11);
var _v$9 = _$escape(s);
const newLineLiteral = _$ssr(_tmpl$12, _v$9);
var _v$0 = _$escape(expr);
const trailingSpace = _$ssr(_tmpl$13, _v$0);
const trailingSpaceComp = Comp({
  children: expr
});
const trailingSpaceFrag = expr;
var _v$1 = _$escape(expr);
const leadingSpaceElement = _$ssr(_tmpl$14, _v$1);
const leadingSpaceComponent = Div({
  get children() {
    return [" ", expr];
  }
});
const leadingSpaceFragment = [" ", expr];
var _v$10 = _$escape(expr);
const trailingSpaceElement = _$ssr(_tmpl$15, _v$10);
const trailingSpaceComponent = Div({
  get children() {
    return [expr, " "];
  }
});
const trailingSpaceFragment = [expr, " "];
const escapeAttribute = _$ssr(_tmpl$16);
const escapeCompAttribute = Div({
  normal: "Search\u2026",
  title: "Search&hellip;"
});
var _v$11 = () => _$escape(expr());
const lastElementExpression = _$ssr(_tmpl$17, _v$11);
const messwithTemplates = _$ssr(_tmpl$18);
const nonAsciiText = _$ssr(_tmpl$19);
const nonAsciiSpreadTail = _$ssrElement(
  "a",
  spread,
  undefined,
  false,
  _sk$,
  ' title="Next &#8594;" data-static="\xE9"'
);
const nonAsciiCustomElement = _$ssr(_tmpl$20);
const nonAsciiSpreadStyle = _$ssrElement("style", spread, _$ssr(_tmpl$21), false);
const nonAsciiScriptture = _$ssr(_tmpl$22);
const latin1AndC1 = _$ssr(_tmpl$23);
const nonAsciiSpreadXmp = _$ssrElement("xmp", spread, _$ssr(_tmpl$24), false);
const nonAsciiEscapedScript = _$ssr(_tmpl$25);
const nonAsciiCdata = _$ssr(_tmpl$26);
const nonAsciiSpreadXmpElement = _$ssrElement("xmp", spread, _$ssr(_tmpl$27), false);
const nonAsciiSpreadScriptElement = _$ssrElement("script", spread, _$ssr(_tmpl$27), false);
const nonAsciiUnquotedQuote = _$ssr(_tmpl$28);
const nonAsciiPlaintext = _$ssr(_tmpl$29);
