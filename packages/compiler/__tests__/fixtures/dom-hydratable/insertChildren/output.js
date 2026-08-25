import { template as _$template } from "r-dom";
import { getNextElement as _$getNextElement } from "r-dom";
import { getNextMarker as _$getNextMarker } from "r-dom";
import { insert as _$insert } from "r-dom";
import { scope as _$scope } from "r-dom";
import { createComponent as _$createComponent } from "r-dom";
import { spread as _$spread } from "r-dom";
import { mergeProps as _$mergeProps } from "r-dom";
import { runHydrationEvents as _$runHydrationEvents } from "r-dom";
var _tmpl$ = /* @__PURE__ */ _$template(`<div>`);
var _tmpl$2 = /* @__PURE__ */ _$template(`<module>`);
var _tmpl$3 = /* @__PURE__ */ _$template(`<module>Hello`);
var _tmpl$4 = /* @__PURE__ */ _$template(`<module>Hi <!$><!/>`);
var _tmpl$5 = /* @__PURE__ */ _$template(`<module>Hi<!$><!/>`);
var _tmpl$6 = /* @__PURE__ */ _$template(`<div>Test 1`);
var _tmpl$7 = /* @__PURE__ */ _$template(`<module>hello`);
const children = _$getNextElement(_tmpl$);
const dynamic = { children };
const template = _$createComponent(Module, { children });
var _el$2 = _$getNextElement(_tmpl$2);
_$insert(_el$2, children);
const template2 = _el$2;
const template3 = _$getNextElement(_tmpl$3);
var _el$4 = _$getNextElement(_tmpl$2);
_$insert(_el$4, _$createComponent(Hello, {}));
const template4 = _el$4;
var _el$5 = _$getNextElement(_tmpl$2);
_$insert(_el$5, _$scope(() => {
	return dynamic.children;
}));
const template5 = _el$5;
const template6 = _$createComponent(Module, { get children() {
	return dynamic.children;
} });
var _el$6 = _$getNextElement(_tmpl$2);
_$spread(_el$6, dynamic, false);
_$runHydrationEvents();
const template7 = _el$6;
var _el$7 = _$getNextElement(_tmpl$3);
_$spread(_el$7, dynamic, true);
_$runHydrationEvents();
const template8 = _el$7;
var _el$8 = _$getNextElement(_tmpl$2);
_$spread(_el$8, dynamic, true);
_$insert(_el$8, _$scope(() => {
	return dynamic.children;
}));
_$runHydrationEvents();
const template9 = _el$8;
const template10 = _$createComponent(Module, _$mergeProps(dynamic, { children: "Hello" }));
var _el$9 = _$getNextElement(_tmpl$2);
_$insert(
	_el$9,
	/*@static*/
	state.children
);
const template11 = _el$9;
const template12 = _$createComponent(Module, { children: /*@static*/ state.children });
var _el$10 = _$getNextElement(_tmpl$2);
_$insert(_el$10, children);
const template13 = _el$10;
const template14 = _$createComponent(Module, { children });
var _el$11 = _$getNextElement(_tmpl$2);
_$insert(_el$11, _$scope(() => {
	return dynamic.children;
}));
const template15 = _el$11;
const template16 = _$createComponent(Module, { get children() {
	return dynamic.children;
} });
var _el$12 = _$getNextElement(_tmpl$4);
var _el$13 = _el$12.firstChild;
var [_el$14, _el$15] = _$getNextMarker(_el$13.nextSibling);
_$insert(_el$12, children, _el$14, _el$15);
const template18 = _el$12;
const template19 = _$createComponent(Module, { get children() {
	return ["Hi ", children];
} });
var _el$16 = _$getNextElement(_tmpl$2);
_$insert(_el$16, _$scope(() => {
	return children();
}));
const template20 = _el$16;
const template21 = _$createComponent(Module, { get children() {
	return children();
} });
var _el$17 = _$getNextElement(_tmpl$2);
_$insert(_el$17, _$scope(() => {
	return state.children();
}));
const template22 = _el$17;
const template23 = _$createComponent(Module, { get children() {
	return state.children();
} });
var _el$18 = _$getNextElement(_tmpl$5);
var _el$19 = _el$18.firstChild;
var _el$20 = _el$19.nextSibling;
var [_el$21, _el$22] = _$getNextMarker(_el$20.nextSibling);
_$spread(_el$18, dynamic, true);
_$insert(_el$18, _$scope(() => {
	return dynamic.children;
}), _el$21, _el$22);
_$runHydrationEvents();
const template24 = _el$18;
const tiles = [];
tiles.push(_$getNextElement(_tmpl$6));
var _el$24 = _$getNextElement(_tmpl$);
_$insert(_el$24, tiles);
const template25 = _el$24;
var _el$25 = _$getNextElement(_tmpl$);
_$insert(_el$25, () => {
	return expression(), "static";
});
const comma = _el$25;
var _el$26 = _$getNextElement(_tmpl$);
_$insert(_el$26, _$scope(() => {
	return children()();
}));
const double = _el$26;
const hello = "hello";
const staticChildren = _$getNextElement(_tmpl$7);
const foldedChildren = _$getNextElement(_tmpl$7);
var _el$29 = _$getNextElement(_tmpl$2);
_$spread(_el$29, _$mergeProps({ get children() {
	return fallback();
} }, props), false);
_$runHydrationEvents();
const childrenBeforeSpread = _el$29;
var _el$30 = _$getNextElement(_tmpl$2);
_$spread(_el$30, _$mergeProps(props, { get children() {
	return later();
} }), false);
_$runHydrationEvents();
const childrenAfterSpread = _el$30;
