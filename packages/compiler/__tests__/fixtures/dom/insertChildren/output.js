import { template as _$template } from "r-dom";
import { insert as _$insert } from "r-dom";
import { createComponent as _$createComponent } from "r-dom";
import { spread as _$spread } from "r-dom";
import { mergeProps as _$mergeProps } from "r-dom";
var _tmpl$ = /* @__PURE__ */ _$template(`<div>`);
var _tmpl$2 = /* @__PURE__ */ _$template(`<module>`);
var _tmpl$3 = /* @__PURE__ */ _$template(`<module>Hello`);
var _tmpl$4 = /* @__PURE__ */ _$template(`<module>Hi `);
var _tmpl$5 = /* @__PURE__ */ _$template(`<module>Hi`);
var _tmpl$6 = /* @__PURE__ */ _$template(`<div>Test 1`);
var _tmpl$7 = /* @__PURE__ */ _$template(`<module>hello`);
const children = _tmpl$();
const dynamic = { children };
const template = _$createComponent(Module, { children });
var _el$2 = _tmpl$2();
_$insert(_el$2, children);
const template2 = _el$2;
const template3 = _tmpl$3();
var _el$4 = _tmpl$2();
_$insert(_el$4, _$createComponent(Hello, {}));
const template4 = _el$4;
var _el$5 = _tmpl$2();
_$insert(_el$5, () => {
	return dynamic.children;
});
const template5 = _el$5;
const template6 = _$createComponent(Module, { get children() {
	return dynamic.children;
} });
var _el$6 = _tmpl$2();
_$spread(_el$6, dynamic, false);
const template7 = _el$6;
var _el$7 = _tmpl$3();
_$spread(_el$7, dynamic, true);
const template8 = _el$7;
var _el$8 = _tmpl$2();
_$spread(_el$8, dynamic, true);
_$insert(_el$8, () => {
	return dynamic.children;
});
const template9 = _el$8;
const template10 = _$createComponent(Module, _$mergeProps(dynamic, { children: "Hello" }));
var _el$9 = _tmpl$2();
_$insert(
	_el$9,
	/*@static*/
	state.children
);
const template11 = _el$9;
const template12 = _$createComponent(Module, { children: /*@static*/ state.children });
var _el$10 = _tmpl$2();
_$insert(_el$10, children);
const template13 = _el$10;
const template14 = _$createComponent(Module, { children });
var _el$11 = _tmpl$2();
_$insert(_el$11, () => {
	return dynamic.children;
});
const template15 = _el$11;
const template16 = _$createComponent(Module, { get children() {
	return dynamic.children;
} });
var _el$12 = _tmpl$4();
_$insert(_el$12, children, null);
const template18 = _el$12;
const template19 = _$createComponent(Module, { get children() {
	return ["Hi ", children];
} });
var _el$13 = _tmpl$2();
_$insert(_el$13, children);
const template20 = _el$13;
const template21 = _$createComponent(Module, { get children() {
	return children();
} });
var _el$14 = _tmpl$2();
_$insert(_el$14, () => {
	return state.children();
});
const template22 = _el$14;
const template23 = _$createComponent(Module, { get children() {
	return state.children();
} });
var _el$15 = _tmpl$5();
var _el$16 = _el$15.firstChild;
_$spread(_el$15, dynamic, true);
_$insert(_el$15, () => {
	return dynamic.children;
}, null);
const template24 = _el$15;
const tiles = [];
tiles.push(_tmpl$6());
var _el$18 = _tmpl$();
_$insert(_el$18, tiles);
const template25 = _el$18;
var _el$19 = _tmpl$();
_$insert(_el$19, () => {
	return expression(), "static";
});
const comma = _el$19;
var _el$20 = _tmpl$();
_$insert(_el$20, () => {
	return children()();
});
const double = _el$20;
const hello = "hello";
const staticChildren = _tmpl$7();
const foldedChildren = _tmpl$7();
var _el$23 = _tmpl$2();
_$spread(_el$23, _$mergeProps({ get children() {
	return fallback();
} }, props), false);
const childrenBeforeSpread = _el$23;
var _el$24 = _tmpl$2();
_$spread(_el$24, _$mergeProps(props, { get children() {
	return later();
} }), false);
const childrenAfterSpread = _el$24;
