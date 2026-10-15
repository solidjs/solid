import { ssrElement as _$ssrElement } from "r-server";
import { ssrClassName as _$ssrClassName } from "r-server";
import { ssrGroup as _$ssrGroup } from "r-server";
import { ssrAttribute as _$ssrAttribute } from "r-server";
import { escape as _$escape } from "r-server";
import { ssr as _$ssr } from "r-server";
import { ssrLinkClaim as _$ssrLinkClaim } from "r-server";
var _lv$, _lv$2, _lv$3, _lv$4, _lv$5, _lv$6, _lv$7, _lv$8, _lv$9;
var _tmpl$ = [
    '<nav><a href="/"',
    '>Home</a><a href="/about"',
    '>About</a><a href="/about" rel="noopener"',
    '>About (rel travels)</a><a href="/docs" link',
    '>explicit-links marker travels</a><a href="/x" target',
    '>empty target is still a link</a><a href="https://example.com/x"',
    '>http(s) may be this origin: the handler decides</a><a href="//cdn.example.com/x"',
    ">protocol-relative too</a></nav>"
  ],
  _tmpl$2 = [
    '<nav><a href="/about" target="_blank">target</a><a href="/file.pdf" download>download</a><a href="/x" rel="nofollow external">rel external</a><a href="/x" aria-current="page">the author\'s aria-current</a><a href="mailto:a@b.c">mailto</a><a href="tel:+1">tel</a><a href>empty</a><a>no href</a><a',
    ">not the href attribute</a></nav>"
  ],
  _tmpl$3 = ["<a", "", ">member</a>"],
  _tmpl$4 = ['<a href="', '"', ">template literal keeps its quoted slot</a>"],
  _tmpl$5 = ["<a", "", "", ">every dynamic link attribute travels</a>"],
  _tmpl$6 = ['<a href="/x"', "", ">mixed</a>"],
  _tmpl$7 = ["<a", "", "", ">the runtime applies the author's precedence</a>"],
  _tmpl$8 = ["<a", "", ">eager hole after an eager attribute</a>"],
  _tmpl$9 = ["<a", "", ">conditional</a>"],
  _tmpl$0 = ['<a href="/x"', "", "", ">static link attributes stay hoisted</a>"];
var _lk$ = {
    href: "/"
  },
  _lk$2 = {
    href: "/about"
  },
  _lk$3 = {
    href: "/about",
    rel: "noopener"
  },
  _lk$4 = {
    href: "/docs",
    link: ""
  },
  _lk$5 = {
    href: "/x",
    target: ""
  },
  _lk$6 = {
    href: "https://example.com/x"
  },
  _lk$7 = {
    href: "//cdn.example.com/x"
  },
  _lk$8 = {
    href: "/x"
  };
var _sk$ = k => k === "class";
// Link claims (solidjs/solid#3878): a candidate anchor gets one hole after
// its attributes — `_$ssrLinkClaim(attrs)` — where a render's link handler
// writes the anchor's link state into the server HTML, `""` otherwise.

// Static anchors: one eager call over a hoisted attributes object, shared by
// every anchor that writes the same attributes.
const nav = _$ssr(
  _tmpl$,
  _$ssrLinkClaim(_lk$),
  _$ssrLinkClaim(_lk$2),
  _$ssrLinkClaim(_lk$3),
  _$ssrLinkClaim(_lk$4),
  _$ssrLinkClaim(_lk$5),
  _$ssrLinkClaim(_lk$6),
  _$ssrLinkClaim(_lk$7)
);

// Ruled out at compile time — no hole, no per-render call: these can never
// be the current page whatever the request looks like.
const excluded = _$ssr(_tmpl$2, _$ssrAttribute("xlink:href", _$escape(url, true)));

// Dynamic anchors: the attribute hole evaluates the raw value once into a
// temp the link hole reads after it, inside the element's attribute group.
var _g$ = _$ssrGroup(
  () => [
    _$ssrAttribute("href", _$escape((_lv$ = props.to), true)),
    _$ssrLinkClaim({
      href: _lv$
    })
  ],
  2
);
const member = _$ssr(_tmpl$3, _g$, _g$);
var _g$2 = _$ssrGroup(
  () => [
    _$escape((_lv$2 = `/users/${props.id}`), true),
    _$ssrLinkClaim({
      href: _lv$2
    })
  ],
  2
);
const template = _$ssr(_tmpl$4, _g$2, _g$2);
var _g$3 = _$ssrGroup(
  () => [
    _$ssrAttribute("href", _$escape((_lv$3 = props.to), true)),
    _$ssrAttribute("target", _$escape((_lv$4 = props.target), true)),
    _$ssrLinkClaim({
      href: _lv$3,
      target: _lv$4
    })
  ],
  3
);
const dynamicTarget = _$ssr(_tmpl$5, _g$3, _g$3, _g$3);
var _g$4 = _$ssrGroup(
  () => [
    _$ssrAttribute("target", _$escape((_lv$5 = props.target), true)),
    _$ssrLinkClaim({
      href: "/x",
      target: _lv$5
    })
  ],
  2
);
const staticHrefDynamicTarget = _$ssr(_tmpl$6, _g$4, _g$4);
var _g$5 = _$ssrGroup(
  () => [
    _$ssrAttribute("href", _$escape((_lv$6 = props.to), true)),
    _$ssrAttribute("aria-current", _$escape((_lv$7 = props.current), true)),
    _$ssrLinkClaim({
      href: _lv$6,
      "aria-current": _lv$7
    })
  ],
  3
);
const dynamicAriaCurrent = _$ssr(_tmpl$7, _g$5, _g$5, _g$5);
const nonDynamic = _$ssr(
  _tmpl$8,
  _$ssrAttribute("href", _$escape((_lv$8 = to), true)),
  _$ssrLinkClaim({
    href: _lv$8
  })
);
const conditional = _$ssr(
  _tmpl$9,
  _$ssrAttribute("href", _$escape((_lv$9 = cond ? "/a" : "/b"), true)),
  _$ssrLinkClaim({
    href: _lv$9
  })
);
var _g$6 = _$ssrGroup(
  () => [
    (_v$11 => (_v$11 == null ? "" : _$ssrAttribute("class", _$ssrClassName(_v$11))))(props.cls),
    _$ssrAttribute("title", _$escape(props.title, true))
  ],
  2
);
const otherDynamics = _$ssr(_tmpl$0, _g$6, _g$6, _$ssrLinkClaim(_lk$8));

// Spread anchors: `ssrElement` collects the link attributes from the walk,
// so an anchor's trailing link attributes stay a source instead of baked
// tail markup.
const spread = _$ssrElement("a", props, "spread", false);
const spreadTrailingHref = _$ssrElement(
  "a",
  [
    props,
    {
      href: "/x"
    }
  ],
  "trailing href stays a source",
  false,
  _sk$,
  ' class="c"'
);
const spreadDynamicHref = _$ssrElement(
  "a",
  [
    props,
    {
      get href() {
        return props.to;
      }
    }
  ],
  "dynamic trailing href",
  false
);
