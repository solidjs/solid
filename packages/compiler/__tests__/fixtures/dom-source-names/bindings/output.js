import { template as _$template } from "r-dom";
import { insert as _$insert } from "r-dom";
import { createComponent as _$createComponent } from "r-dom";
import { spread as _$spread } from "r-dom";
import { setStyleProperty as _$setStyleProperty } from "r-dom";
import { readShallow as _$readShallow } from "r-dom";
import { className as _$className } from "r-dom";
import { effect as _$effect } from "r-dom";
import { setAttribute as _$setAttribute } from "r-dom";
import { claimElement as _$claimElement } from "r-dom";
var _tmpl$ = /* @__PURE__ */ _$template(`<span> `);
var _tmpl$2 = /* @__PURE__ */ _$template(`<input>`);
var _tmpl$3 = /* @__PURE__ */ _$template(`<div>`);
var _tmpl$4 = /* @__PURE__ */ _$template(`<button><span> `);
var _tmpl$5 = /* @__PURE__ */ _$template(`<div>Hello <!>!<p></p><!>`);
var _tmpl$6 = /* @__PURE__ */ _$template(`<div>text`);
var _tmpl$7 = /* @__PURE__ */ _$template(`<section>`);
var _tmpl$8 = /* @__PURE__ */ _$template(`<a>`);
var _el$ = _tmpl$();
var _el$2 = _el$.firstChild;
_$effect(() => label(), (_v$) => {
	_el$2.data = _v$;
}, { name: "span.textContent" });
// One binding → its own effect, named `<tag>.<attribute>`.
const single = _el$;
var _el$3 = _tmpl$2();
_$effect(() => text(), (_v$) => {
	_el$3.value = _v$ ?? "";
}, { name: "input.value" });
const attr = _el$3;
var _el$4 = _tmpl$3();
_$effect(() => _$readShallow(active() ? "on" : "off"), (_v$, _$p) => {
	_$className(_el$4, _v$, _$p);
}, { name: "div.class" });
const cls = _el$4;
var _el$5 = _tmpl$3();
_$effect(() => {
	return {
		e: color(),
		t: size()
	};
}, ({ e, t }, _p$) => {
	e !== _p$?.e && _$setStyleProperty(_el$5, "color", e);
	t !== _p$?.t && _$setStyleProperty(_el$5, "font-size", t);
}, { name: "div.style:color, div.style:font-size" });
const style = _el$5;
var _el$6 = _tmpl$3();
_$effect(() => ({ active: active() }), (_v$) => {
	_$setAttribute(_el$6, "classList", _v$);
}, { name: "div.classList" });
const classList = _el$6;
var _el$7 = _tmpl$3();
_$effect(() => {
	return {
		e: selected(),
		t: width()
	};
}, ({ e, t }, _p$) => {
	e !== _p$?.e && _$setAttribute(_el$7, "class:selected", e);
	t !== _p$?.t && _$setAttribute(_el$7, "style:width", t);
}, { name: "div.class:selected, div.style:width" });
const ns = _el$7;
var _el$8 = _tmpl$4();
var _el$9 = _el$8.firstChild;
var _el$10 = _el$9.firstChild;
_$effect(() => {
	return {
		e: _$readShallow(cls()),
		t: title(),
		a: off(),
		o: label()
	};
}, ({ e, t, a, o }, _p$) => {
	_$className(_el$8, e, _p$?.e);
	t !== _p$?.t && _$setAttribute(_el$8, "title", t);
	a !== _p$?.a && _$setAttribute(_el$8, "disabled", a);
	(!_p$ || o !== _p$.o) && (_el$10.data = o);
}, { name: "button.class, button.title, button.disabled, span.textContent" });
// Several bindings in one template → one merged effect listing all of them.
const merged = _el$8;
var _el$11 = _tmpl$3();
_$insert(_el$11, count, undefined, undefined, { name: "div.children" });
// Holes → insert, named for the parent it fills.
const hole = _el$11;
var _el$12 = _tmpl$5();
var _el$13 = _el$12.firstChild;
var _el$14 = _el$13.nextSibling;
var _el$15 = _el$14.nextSibling;
var _el$16 = _el$15.nextSibling;
var _el$17 = _el$16.nextSibling;
_$insert(_el$12, name, _el$14, undefined, { name: "div.children" });
_$insert(_el$16, greeting, undefined, undefined, { name: "p.children" });
_$insert(_el$12, list, _el$17, undefined, { name: "div.children" });
const holes = _el$12;
const staticChild = _tmpl$6();
var _el$19 = _tmpl$3();
_$insert(_el$19, _$createComponent(Child, {}, "Child"));
const componentChild = _el$19;
var _el$20 = _tmpl$3();
_$spread(_el$20, props, false, undefined, "div");
// Spreads → the tag rides as spread's trailing argument.
const spread = _el$20;
var _el$21 = _tmpl$7();
_$spread(_el$21, props, true, undefined, "section");
_$insert(_el$21, children, undefined, undefined, { name: "section.children" });
const spreadWithChildren = _el$21;
var _el$22 = _tmpl$8();
_$claimElement(_el$22);
_$spread(_el$22, [
	{ get href() {
		return href();
	} },
	rest,
	{ title: "static" }
], false, undefined, "a");
const spreadMixed = _el$22;
