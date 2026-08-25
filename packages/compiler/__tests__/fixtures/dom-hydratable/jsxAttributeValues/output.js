import { template as _$template } from "r-dom";
import { getNextElement as _$getNextElement } from "r-dom";
import { insert as _$insert } from "r-dom";
import { createComponent as _$createComponent } from "r-dom";
import { spread as _$spread } from "r-dom";
import { mergeProps as _$mergeProps } from "r-dom";
import { ref as _$ref } from "r-dom";
import { effect as _$effect } from "r-dom";
import { setAttribute as _$setAttribute } from "r-dom";
import { delegateEvents as _$delegateEvents } from "r-dom";
import { runHydrationEvents as _$runHydrationEvents } from "r-dom";
var _tmpl$ = /* @__PURE__ */ _$template(`<div>after`);
var _tmpl$2 = /* @__PURE__ */ _$template(`<div>`);
var _tmpl$3 = /* @__PURE__ */ _$template(`<button>go`);
var _tmpl$4 = /* @__PURE__ */ _$template(`<span>static`);
var _tmpl$5 = /* @__PURE__ */ _$template(`<span>`);
var _tmpl$6 = /* @__PURE__ */ _$template(`<label>`);
var _tmpl$7 = /* @__PURE__ */ _$template(`<div>content`);
var _tmpl$8 = /* @__PURE__ */ _$template(`<span>own`);
var _tmpl$9 = /* @__PURE__ */ _$template(`<h1>fallback`);
var _el$ = _$getNextElement(_tmpl$);
_$setAttribute(_el$, "data", _$getNextElement(_tmpl$4));
const staticValue = _el$;
var _el$2 = _$getNextElement(_tmpl$);
_$effect(() => (() => {
	var _el$10 = _$getNextElement(_tmpl$5);
	_$insert(_el$10, () => {
		return state.value;
	});
	return _el$10;
})(), (_v$) => {
	_$setAttribute(_el$2, "data", _v$);
});
const dynamicValue = _el$2;
var _el$3 = _$getNextElement(_tmpl$2);
_$effect((() => state.compute()), (_v$) => {
	_$setAttribute(_el$3, "data", _v$);
});
const iifeValue = _el$3;
var _el$4 = _$getNextElement(_tmpl$2);
_$effect(() => {
	return {
		e: (() => {
			var _el$11 = _$getNextElement(_tmpl$5);
			_$insert(_el$11, () => {
				return state.first;
			});
			return _el$11;
		})(),
		t: (() => {
			var _el$12 = _$getNextElement(_tmpl$6);
			_$insert(_el$12, () => {
				return state.second;
			});
			return _el$12;
		})()
	};
}, ({ e, t }, _p$) => {
	e !== _p$?.e && _$setAttribute(_el$4, "first", e);
	t !== _p$?.t && _$setAttribute(_el$4, "second", t);
});
const multiValues = _el$4;
var _el$5 = _$getNextElement(_tmpl$3);
_el$5.$$click = () => mount(_$getNextElement(_tmpl$7));
_$runHydrationEvents();
const handlerValue = _el$5;
var _el$6 = _$getNextElement(_tmpl$2);
_$ref(() => {
	return (el) => el.appendChild(_$getNextElement(_tmpl$8));
}, _el$6);
const refValue = _el$6;
var _el$7 = _$getNextElement(_tmpl$2);
_$spread(_el$7, _$mergeProps(props, { get data() {
	var _el$15 = _$getNextElement(_tmpl$5);
	_$insert(_el$15, () => {
		return state.value;
	});
	return _el$15;
} }), false);
_$runHydrationEvents();
const spreadValue = _el$7;
var _el$8 = _$getNextElement(_tmpl$2);
_$insert(_el$8, _$createComponent(Comp, { get fallback() {
	return _$getNextElement(_tmpl$9);
} }));
const propValue = _el$8;
_$delegateEvents(["click"]);
