import { template as _$template } from "r-dom";
import { insert as _$insert } from "r-dom";
import { memo as _$memo } from "r-dom";
import { createComponent as _$createComponent } from "r-dom";
import { spread as _$spread } from "r-dom";
import { setStyleProperty as _$setStyleProperty } from "r-dom";
import { group as _$group } from "r-dom";
import { readShallow as _$readShallow } from "r-dom";
import { className as _$className } from "r-dom";
import { effect as _$effect } from "r-dom";
import { setAttribute as _$setAttribute } from "r-dom";
var _tmpl$ = /* @__PURE__ */ _$template(`<div>`);
var _tmpl$2 = /* @__PURE__ */ _$template(`<p>Count: `);
var _tmpl$3 = /* @__PURE__ */ _$template(`<section>`);
// `sourceNames.locations`: every label carries where its JSX is written,
// `file:line:col` relative to `root` (here the fixtures directory, resolved
// against the working directory), line and column 1-based.
import { Layout, Card, Row } from "./components";
// Nested components → each `createComponent` points at its own `<Tag`.
const nested = _$createComponent(Layout, { get children() {
	return _$createComponent(Card, {
		title: "Hello",
		get children() {
			return _$createComponent(Row, {}, "Row", "locations/code.jsx:10:7");
		}
	}, "Card", "locations/code.jsx:9:5");
} }, "Layout", "locations/code.jsx:8:3");
var _el$ = _tmpl$();
_$effect(_$group({
	e: () => _$readShallow(cls()),
	t: () => title()
}), ({ e, t }, _p$) => {
	_$className(_el$, e, _p$?.e);
	t !== _p$?.t && _$setAttribute(_el$, "title", t);
}, {
	name: "div.class, div.title",
	loc: "locations/code.jsx:17:24"
});
// An attribute binding → the attribute's start; a merged effect points at
// the first binding it lists.
const attribute = _el$;
var _el$2 = _tmpl$();
_$effect(() => color(), (_v$) => {
	_$setStyleProperty(_el$2, "color", _v$);
}, {
	name: "div.style:color",
	loc: "locations/code.jsx:18:26"
});
const styleObject = _el$2;
var _el$3 = _tmpl$2();
var _el$4 = _el$3.firstChild;
_$insert(_el$3, count, null, undefined, {
	name: "p.children",
	loc: "locations/code.jsx:21:24"
});
// A hole → the `{` of the expression.
const hole = _el$3;
var _el$5 = _tmpl$3();
_$spread(_el$5, props, false, undefined, "section", "locations/code.jsx:24:25");
// A spread → the `{...` of the first spread attribute.
const spread = _el$5;
var _el$6 = _tmpl$();
_$insert(_el$6, (() => {
	var _c$ = _$memo(() => {
		return !!visible();
	});
	return () => {
		return _c$() ? _$createComponent(Card, { title: "On" }, "Card", "locations/code.jsx:27:39") : null;
	};
})(), undefined, undefined, {
	name: "div.children",
	loc: "locations/code.jsx:27:26"
});
// A component inside a conditional → the conditional's memo keeps the label.
const conditional = _el$6;
