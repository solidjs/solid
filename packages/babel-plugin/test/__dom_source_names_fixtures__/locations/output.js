import { template as _$template } from "r-dom";
import { memo as _$memo } from "r-dom";
import { spread as _$spread } from "r-dom";
import { insert as _$insert } from "r-dom";
import { setStyleProperty as _$setStyleProperty } from "r-dom";
import { group as _$group } from "r-dom";
import { setAttribute as _$setAttribute } from "r-dom";
import { className as _$className } from "r-dom";
import { readShallow as _$readShallow } from "r-dom";
import { effect as _$effect } from "r-dom";
import { createComponent as _$createComponent } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(`<div>`),
  _tmpl$2 = /*#__PURE__*/ _$template(`<p>Count: `),
  _tmpl$3 = /*#__PURE__*/ _$template(`<section>`);
// `sourceNames.locations`: every label carries where its JSX is written,
// `file:line:col` relative to `root` (here the fixtures directory, resolved
// against the working directory), line and column 1-based.
import { Layout, Card, Row } from "./components";

// Nested components → each `createComponent` points at its own `<Tag`.
const nested = _$createComponent(
  Layout,
  {
    get children() {
      return _$createComponent(
        Card,
        {
          title: "Hello",
          get children() {
            return _$createComponent(Row, {}, "Row", "locations/code.js:10:7");
          }
        },
        "Card",
        "locations/code.js:9:5"
      );
    }
  },
  "Layout",
  "locations/code.js:8:3"
);

// An attribute binding → the attribute's start; a merged effect points at
// the first binding it lists.
var _el$ = _tmpl$();
_$effect(
  _$group({
    e: () => _$readShallow(cls()),
    t: () => title()
  }),
  ({ e, t }, _p$) => {
    _$className(_el$, e, _p$?.e);
    t !== _p$?.t && _$setAttribute(_el$, "title", t);
  },
  {
    name: "div.class, div.title",
    loc: "locations/code.js:17:24"
  }
);
const attribute = _el$;
var _el$2 = _tmpl$();
_$effect(
  () => color(),
  _v$ => {
    _$setStyleProperty(_el$2, "color", _v$);
  },
  {
    name: "div.style:color",
    loc: "locations/code.js:18:26"
  }
);
const styleObject = _el$2;

// A hole → the `{` of the expression.
var _el$3 = _tmpl$2(),
  _el$4 = _el$3.firstChild;
_$insert(_el$3, count, null, undefined, {
  name: "p.children",
  loc: "locations/code.js:21:24"
});
const hole = _el$3;

// A spread → the `{...` of the first spread attribute.
var _el$5 = _tmpl$3();
_$spread(_el$5, props, false, undefined, "section", "locations/code.js:24:25");
const spread = _el$5;

// A component inside a conditional → the conditional's memo keeps the label.
var _el$6 = _tmpl$();
_$insert(
  _el$6,
  (() => {
    var _c$ = _$memo(() => !!visible());
    return () =>
      _c$()
        ? _$createComponent(
            Card,
            {
              title: "On"
            },
            "Card",
            "locations/code.js:27:39"
          )
        : null;
  })(),
  undefined,
  undefined,
  {
    name: "div.children",
    loc: "locations/code.js:27:26"
  }
);
const conditional = _el$6;
