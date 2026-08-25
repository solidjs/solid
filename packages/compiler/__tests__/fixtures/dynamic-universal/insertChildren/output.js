import { createTextNode as _$createTextNode } from "r-custom";
import { createComponent as _$createComponent } from "r-custom";
import { mergeProps as _$mergeProps } from "r-custom";
import { spread as _$spread } from "r-custom";
import { insert as _$insert } from "r-custom";
import { insertNode as _$insertNode } from "r-custom";
import { createElement as _$createElement } from "r-custom";
const children = _$createElement("div");
const dynamic = { children };
const template = _$createComponent(Module, { children });
var _el$2 = _$createElement("module");
_$insert(_el$2, children);
const template2 = _el$2;
var _el$3 = _$createElement("module");
_$insertNode(_el$3, _$createTextNode("Hello"));
const template3 = _el$3;
var _el$4 = _$createElement("module");
_$insert(_el$4, _$createComponent(Hello, {}));
const template4 = _el$4;
var _el$5 = _$createElement("module");
_$insert(_el$5, () => {
	return dynamic.children;
});
const template5 = _el$5;
const template6 = _$createComponent(Module, { get children() {
	return dynamic.children;
} });
var _el$6 = _$createElement("module");
_$spread(_el$6, dynamic, false);
const template7 = _el$6;
var _el$7 = _$createElement("module");
_$insertNode(_el$7, _$createTextNode("Hello"));
_$spread(_el$7, dynamic, true);
const template8 = _el$7;
var _el$8 = _$createElement("module");
_$spread(_el$8, dynamic, true);
_$insert(_el$8, () => {
	return dynamic.children;
});
const template9 = _el$8;
const template10 = _$createComponent(Module, _$mergeProps(dynamic, { children: "Hello" }));
var _el$9 = _$createElement("module");
_$insert(
	_el$9,
	/*@static*/
	state.children
);
const template11 = _el$9;
const template12 = _$createComponent(Module, { children: /*@static*/ state.children });
var _el$10 = _$createElement("module");
_$insert(_el$10, children);
const template13 = _el$10;
const template14 = _$createComponent(Module, { children });
var _el$11 = _$createElement("module");
_$insert(_el$11, () => {
	return dynamic.children;
});
const template15 = _el$11;
const template16 = _$createComponent(Module, { get children() {
	return dynamic.children;
} });
var _el$12 = _$createElement("module");
var _el$13 = _$createTextNode("Hi ");
_$insertNode(_el$12, _el$13);
_$insert(_el$12, children, null);
const template18 = _el$12;
const template19 = _$createComponent(Module, { get children() {
	return ["Hi ", children];
} });
var _el$14 = _$createElement("module");
_$insert(_el$14, children);
const template20 = _el$14;
const template21 = _$createComponent(Module, { get children() {
	return children();
} });
var _el$15 = _$createElement("module");
_$insert(_el$15, () => {
	return state.children();
});
const template22 = _el$15;
const template23 = _$createComponent(Module, { get children() {
	return state.children();
} });
const tiles = [];
tiles.push((() => {
	var _el$16 = _$createElement("div");
	_$insertNode(_el$16, _$createTextNode("Test 1"));
	return _el$16;
})());
var _el$17 = _$createElement("div");
_$insert(_el$17, tiles);
const template24 = _el$17;
var _el$18 = _$createElement("div");
_$insert(_el$18, () => {
	return expression(), "static";
});
const comma = _el$18;
var _el$19 = _$createElement("div");
_$insert(_el$19, () => {
	return children()();
});
const double = _el$19;
const hello = "hello";
var _el$20 = _$createElement("module");
_$insertNode(_el$20, _$createTextNode("hello"));
const staticChildren = _el$20;
var _el$21 = _$createElement("module");
_$insertNode(_el$21, _$createTextNode("hello"));
const foldedChildren = _el$21;
var _el$22 = _$createElement("module");
_$spread(_el$22, _$mergeProps({ get children() {
	return fallback();
} }, props), false);
const childrenBeforeSpread = _el$22;
var _el$23 = _$createElement("module");
_$spread(_el$23, _$mergeProps(props, { get children() {
	return later();
} }), false);
const childrenAfterSpread = _el$23;
