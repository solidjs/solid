import { template as _$template } from "r-dom";
import { getOwner as _$getOwner } from "r-dom";
import { spread as _$spread } from "r-dom";
import { ref as _$ref } from "r-dom";
import { effect as _$effect } from "r-dom";
import { setAttribute as _$setAttribute } from "r-dom";
import { claimElement as _$claimElement } from "r-dom";
var _tmpl$ = /* @__PURE__ */ _$template(`<a href=/static>Static`);
var _tmpl$2 = /* @__PURE__ */ _$template(`<a>Written`);
var _tmpl$3 = /* @__PURE__ */ _$template(`<a>One`);
var _tmpl$4 = /* @__PURE__ */ _$template(`<a href=/docs>Many`);
var _tmpl$5 = /* @__PURE__ */ _$template(`<div><a>First</a><span></span><a href=/second>Second`);
var _tmpl$6 = /* @__PURE__ */ _$template(`<form method=post>`);
var _tmpl$7 = /* @__PURE__ */ _$template(`<a>`);
var _el$ = _tmpl$();
_$claimElement(_el$);
// Element claims (#3923): `a[href]` / `form[action]` are claimed once, after
// their initial attributes are applied.
// Fully static: attributes in the template, claimed at creation.
const staticLink = _el$;
var _el$2 = _tmpl$2();
_$setAttribute(_el$2, "href", base);
_$setAttribute(_el$2, "title", label);
var _ref$ = link;
typeof _ref$ === "function" || Array.isArray(_ref$) ? _$ref(() => {
	return _ref$;
}, _el$2) : link = _el$2;
_$claimElement(_el$2);
// Non-reactive expression attributes write at creation; with a ref, the
// claim trails both.
const staticWrites = _el$2;
var _el$3 = _tmpl$3();
var _o$ = _$getOwner();
_$effect(() => href(), (_v$) => {
	_$setAttribute(_el$3, "href", _v$);
	_$claimElement(_el$3, _o$);
});
// One dynamic binding: the claim is the tail of the binding effect, under
// the owner captured at creation.
const oneBinding = _el$3;
var _el$4 = _tmpl$4();
var _o$2 = _$getOwner();
_$effect(() => {
	return {
		e: target(),
		t: rel(),
		a: download()
	};
}, ({ e, t, a }, _p$) => {
	e !== _p$?.e && _$setAttribute(_el$4, "target", e);
	t !== _p$?.t && _$setAttribute(_el$4, "rel", t);
	a !== _p$?.a && _$setAttribute(_el$4, "download", a);
	_$claimElement(_el$4, _o$2);
});
// Several bindings on the target, including ones outside the default
// re-claim set.
const manyBindings = _el$4;
var _el$5 = _tmpl$5();
var _el$6 = _el$5.firstChild;
var _el$7 = _el$6.nextSibling;
var _el$8 = _el$7.nextSibling;
var _o$3 = _$getOwner();
_$claimElement(_el$8);
_$effect(() => {
	return {
		e: first(),
		t: title()
	};
}, ({ e, t }, _p$) => {
	e !== _p$?.e && _$setAttribute(_el$6, "href", e);
	t !== _p$?.t && _$setAttribute(_el$7, "title", t);
	_$claimElement(_el$6, _o$3);
});
// Nested under a template root with bindings on other elements: one effect,
// the claim after every binding; the static sibling is claimed at creation.
const nested = _el$5;
var _el$9 = _tmpl$6();
var _o$4 = _$getOwner();
_$effect(() => action(), (_v$) => {
	_$setAttribute(_el$9, "action", _v$);
	_$claimElement(_el$9, _o$4);
});
// A form claims on `action`.
const form = _el$9;
var _el$10 = _tmpl$7();
_$spread(_el$10, props, false);
// A spread may carry the attribute: the spread runtime claims after its
// first application, so no compiled claim.
const spread = _el$10;
var _el$11 = _tmpl$7();
_$spread(_el$11, [
	{ get href() {
		return href();
	} },
	rest,
	{ target: "_blank" }
], false);
const spreadMixed = _el$11;
