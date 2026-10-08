import { template as _$template } from "r-dom";
import { spread as _$spread } from "r-dom";
import { effect as _$effect } from "r-dom";
import { getOwner as _$getOwner } from "r-dom";
import { ref as _$ref } from "r-dom";
import { setAttribute as _$setAttribute } from "r-dom";
import { claimElement as _$claimElement } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(`<a href=/static>Static`),
  _tmpl$2 = /*#__PURE__*/ _$template(`<a>Written`),
  _tmpl$3 = /*#__PURE__*/ _$template(`<a>One`),
  _tmpl$4 = /*#__PURE__*/ _$template(`<a href=/docs>Many`),
  _tmpl$5 = /*#__PURE__*/ _$template(`<div><a>First</a><span></span><a href=/second>Second`),
  _tmpl$6 = /*#__PURE__*/ _$template(`<form method=post>`),
  _tmpl$7 = /*#__PURE__*/ _$template(`<a>`);
var _el$ = _tmpl$();
_$claimElement(_el$);
// Element claims (#3923): `a[href]` / `form[action]` are claimed once, after
// their initial attributes are applied.

// Fully static: attributes in the template, claimed at creation.
const staticLink = _el$;

// Non-reactive expression attributes write at creation; with a ref, the
// claim trails both.
var _el$2 = _tmpl$2();
_$setAttribute(_el$2, "href", base);
_$setAttribute(_el$2, "title", label);
var _ref$ = link;
typeof _ref$ === "function" || Array.isArray(_ref$) ? _$ref(() => _ref$, _el$2) : (link = _el$2);
_$claimElement(_el$2);
const staticWrites = _el$2;

// One dynamic binding: the claim is the tail of the binding effect, under
// the owner captured at creation.
var _el$3 = _tmpl$3(),
  _o$ = _$getOwner();
_$effect(
  () => href(),
  _v$ => {
    _$setAttribute(_el$3, "href", _v$);
    _$claimElement(_el$3, _o$);
  }
);
const oneBinding = _el$3;

// Several bindings on the target, including ones outside the default
// re-claim set.
var _el$4 = _tmpl$4(),
  _o$2 = _$getOwner();
_$effect(
  () => ({
    e: target(),
    t: rel(),
    a: download()
  }),
  ({ e, t, a }, _p$) => {
    e !== _p$?.e && _$setAttribute(_el$4, "target", e);
    t !== _p$?.t && _$setAttribute(_el$4, "rel", t);
    a !== _p$?.a && _$setAttribute(_el$4, "download", a);
    _$claimElement(_el$4, _o$2);
  }
);
const manyBindings = _el$4;

// Nested under a template root with bindings on other elements: one effect,
// the claim after every binding; the static sibling is claimed at creation.
var _el$5 = _tmpl$5(),
  _el$6 = _el$5.firstChild,
  _el$7 = _el$6.nextSibling,
  _el$8 = _el$7.nextSibling,
  _o$3 = _$getOwner();
_$claimElement(_el$8);
_$effect(
  () => ({
    e: first(),
    t: title()
  }),
  ({ e, t }, _p$) => {
    e !== _p$?.e && _$setAttribute(_el$6, "href", e);
    t !== _p$?.t && _$setAttribute(_el$7, "title", t);
    _$claimElement(_el$6, _o$3);
  }
);
const nested = _el$5;

// A form claims on `action`.
var _el$9 = _tmpl$6(),
  _o$4 = _$getOwner();
_$effect(
  () => action(),
  _v$ => {
    _$setAttribute(_el$9, "action", _v$);
    _$claimElement(_el$9, _o$4);
  }
);
const form = _el$9;

// A spread may carry the attribute: the spread runtime claims after its
// first application, so no compiled claim.
var _el$0 = _tmpl$7();
_$spread(_el$0, props, false);
const spread = _el$0;
var _el$1 = _tmpl$7();
_$spread(
  _el$1,
  [
    {
      get href() {
        return href();
      }
    },
    rest,
    {
      target: "_blank"
    }
  ],
  false
);
const spreadMixed = _el$1;
