import { template as _$template } from "r-dom";
import { claimElement as _$claimElement } from "r-dom";
import { getOwner as _$getOwner } from "r-dom";
import { spread as _$spread } from "r-dom";
import { createComponent as _$createComponent } from "r-dom";
import { insert as _$insert } from "r-dom";
import { setAttribute as _$setAttribute } from "r-dom";
import { setStyleProperty as _$setStyleProperty } from "r-dom";
import { className as _$className } from "r-dom";
import { readShallow as _$readShallow } from "r-dom";
import { effect as _$effect } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(`<span> `),
  _tmpl$2 = /*#__PURE__*/ _$template(`<input>`),
  _tmpl$3 = /*#__PURE__*/ _$template(`<div>`),
  _tmpl$4 = /*#__PURE__*/ _$template(`<button><span> `),
  _tmpl$5 = /*#__PURE__*/ _$template(`<div>Hello <!>!<p></p><!>`),
  _tmpl$6 = /*#__PURE__*/ _$template(`<div>text`),
  _tmpl$7 = /*#__PURE__*/ _$template(`<section>`),
  _tmpl$8 = /*#__PURE__*/ _$template(`<a>`),
  _tmpl$9 = /*#__PURE__*/ _$template(`<a>Link`);
var _el$ = _tmpl$(),
  _el$2 = _el$.firstChild;
_$effect(
  () => label(),
  _v$ => {
    _el$2.data = _v$;
  },
  {
    name: "span.textContent",
    loc: "test/__dom_source_names_fixtures__/bindings/code.js:2:22"
  }
);
// One binding → its own effect, named `<tag>.<attribute>`.
const single = _el$;
var _el$3 = _tmpl$2();
_$effect(
  () => text(),
  _v$ => {
    _el$3.value = _v$ ?? "";
  },
  {
    name: "input.value",
    loc: "test/__dom_source_names_fixtures__/bindings/code.js:3:21"
  }
);
const attr = _el$3;
var _el$4 = _tmpl$3();
_$effect(
  () => _$readShallow(active() ? "on" : "off"),
  (_v$, _$p) => {
    _$className(_el$4, _v$, _$p);
  },
  {
    name: "div.class",
    loc: "test/__dom_source_names_fixtures__/bindings/code.js:4:18"
  }
);
const cls = _el$4;
var _el$5 = _tmpl$3();
_$effect(
  () => ({
    e: color(),
    t: size()
  }),
  ({ e, t }, _p$) => {
    e !== _p$?.e && _$setStyleProperty(_el$5, "color", e);
    t !== _p$?.t && _$setStyleProperty(_el$5, "font-size", t);
  },
  {
    name: "div.style:color, div.style:font-size",
    loc: "test/__dom_source_names_fixtures__/bindings/code.js:5:20"
  }
);
const style = _el$5;
var _el$6 = _tmpl$3();
_$effect(
  () => ({
    active: active()
  }),
  _v$ => {
    _$setAttribute(_el$6, "classList", _v$);
  },
  {
    name: "div.classList",
    loc: "test/__dom_source_names_fixtures__/bindings/code.js:6:24"
  }
);
const classList = _el$6;
var _el$7 = _tmpl$3();
_$effect(
  () => ({
    e: selected(),
    t: width()
  }),
  ({ e, t }, _p$) => {
    e !== _p$?.e && _$setAttribute(_el$7, "class:selected", e);
    t !== _p$?.t && _$setAttribute(_el$7, "style:width", t);
  },
  {
    name: "div.class:selected, div.style:width",
    loc: "test/__dom_source_names_fixtures__/bindings/code.js:7:17"
  }
);
const ns = _el$7;

// Several bindings in one template → one merged effect listing all of them.
var _el$8 = _tmpl$4(),
  _el$9 = _el$8.firstChild,
  _el$0 = _el$9.firstChild;
_$effect(
  () => ({
    e: _$readShallow(cls()),
    t: title(),
    a: off(),
    o: label()
  }),
  ({ e, t, a, o }, _p$) => {
    _$className(_el$8, e, _p$?.e);
    t !== _p$?.t && _$setAttribute(_el$8, "title", t);
    a !== _p$?.a && _$setAttribute(_el$8, "disabled", a);
    (!_p$ || o !== _p$.o) && (_el$0.data = o);
  },
  {
    name: "button.class, button.title, button.disabled, span.textContent",
    loc: "test/__dom_source_names_fixtures__/bindings/code.js:11:11"
  }
);
const merged = _el$8;

// Holes → insert, named for the parent it fills.
var _el$1 = _tmpl$3();
_$insert(_el$1, count, undefined, undefined, {
  name: "div.children",
  loc: "test/__dom_source_names_fixtures__/bindings/code.js:17:19"
});
const hole = _el$1;
var _el$10 = _tmpl$5(),
  _el$11 = _el$10.firstChild,
  _el$14 = _el$11.nextSibling,
  _el$12 = _el$14.nextSibling,
  _el$13 = _el$12.nextSibling,
  _el$15 = _el$13.nextSibling;
_$insert(_el$10, name, _el$14, undefined, {
  name: "div.children",
  loc: "test/__dom_source_names_fixtures__/bindings/code.js:20:11"
});
_$insert(_el$13, greeting, undefined, undefined, {
  name: "p.children",
  loc: "test/__dom_source_names_fixtures__/bindings/code.js:20:23"
});
_$insert(_el$10, list, _el$15, undefined, {
  name: "div.children",
  loc: "test/__dom_source_names_fixtures__/bindings/code.js:21:5"
});
const holes = _el$10;
const staticChild = _tmpl$6();
var _el$17 = _tmpl$3();
_$insert(
  _el$17,
  _$createComponent(Child, {}, "Child", "test/__dom_source_names_fixtures__/bindings/code.js:27:5")
);
const componentChild = _el$17;

// Spreads → the tag rides as spread's trailing argument.
var _el$18 = _tmpl$3();
_$spread(
  _el$18,
  props,
  false,
  undefined,
  "div",
  "test/__dom_source_names_fixtures__/bindings/code.js:32:21"
);
const spread = _el$18;
var _el$19 = _tmpl$7();
_$spread(
  _el$19,
  props,
  true,
  undefined,
  "section",
  "test/__dom_source_names_fixtures__/bindings/code.js:33:37"
);
_$insert(_el$19, children, undefined, undefined, {
  name: "section.children",
  loc: "test/__dom_source_names_fixtures__/bindings/code.js:33:48"
});
const spreadWithChildren = _el$19;
var _el$20 = _tmpl$8();
_$spread(
  _el$20,
  [
    {
      get href() {
        return href();
      }
    },
    rest,
    {
      title: "static"
    }
  ],
  false,
  undefined,
  "a",
  "test/__dom_source_names_fixtures__/bindings/code.js:34:38"
);
const spreadMixed = _el$20;

// A claim target with bindings → its claim is the tail of the named effect.
var _el$21 = _tmpl$9(),
  _o$ = _$getOwner();
_$effect(
  () => ({
    e: href(),
    t: target()
  }),
  ({ e, t }, _p$) => {
    e !== _p$?.e && _$setAttribute(_el$21, "href", e);
    t !== _p$?.t && _$setAttribute(_el$21, "target", t);
    _$claimElement(_el$21, _o$);
  },
  {
    name: "a.href, a.target",
    loc: "test/__dom_source_names_fixtures__/bindings/code.js:38:6"
  }
);
const link = _el$21;
