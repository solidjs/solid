import { createTextNode as _$createTextNode } from "r-custom";
import { effect as _$effect } from "r-custom";
import { createComponent as _$createComponent } from "r-custom";
import { mergeProps as _$mergeProps } from "r-custom";
import { spread as _$spread } from "r-custom";
import { insert as _$insert } from "r-custom";
import { insertNode as _$insertNode } from "r-custom";
import { setProp as _$setProp } from "r-custom";
import { ref as _$ref } from "r-custom";
import { createElement as _$createElement } from "r-custom";
var _el$ = _$createElement("div", { data: (() => {
	var _el$2 = _$createElement("span");
	_$insertNode(_el$2, _$createTextNode("static"));
	return _el$2;
})() });
_$insertNode(_el$, _$createTextNode("after"));
const staticValue = _el$;
var _el$3 = _$createElement("div");
_$insertNode(_el$3, _$createTextNode("after"));
_$effect(() => (() => {
	var _el$12 = _$createElement("span");
	_$insert(_el$12, () => {
		return state.value;
	});
	return _el$12;
})(), (_v$, _$p) => {
	_$setProp(_el$3, "data", _v$, _$p);
});
const dynamicValue = _el$3;
var _el$4 = _$createElement("div");
_$effect((() => state.compute()), (_v$, _$p) => {
	_$setProp(_el$4, "data", _v$, _$p);
});
const iifeValue = _el$4;
var _el$5 = _$createElement("div");
_$effect(() => {
	return {
		e: (() => {
			var _el$13 = _$createElement("span");
			_$insert(_el$13, () => {
				return state.first;
			});
			return _el$13;
		})(),
		t: (() => {
			var _el$14 = _$createElement("label");
			_$insert(_el$14, () => {
				return state.second;
			});
			return _el$14;
		})()
	};
}, ({ e, t }, _p$) => {
	e !== _p$?.e && _$setProp(_el$5, "first", e, _p$?.e);
	t !== _p$?.t && _$setProp(_el$5, "second", t, _p$?.t);
});
const multiValues = _el$5;
var _el$6 = _$createElement("button", { onClick: () => mount((() => {
	var _el$7 = _$createElement("div");
	_$insertNode(_el$7, _$createTextNode("content"));
	return _el$7;
})()) });
_$insertNode(_el$6, _$createTextNode("go"));
const handlerValue = _el$6;
var _el$8 = _$createElement("div");
_$ref(() => {
	return (el) => el.appendChild((() => {
		var _el$9 = _$createElement("span");
		_$insertNode(_el$9, _$createTextNode("own"));
		return _el$9;
	})());
}, _el$8);
const refValue = _el$8;
var _el$10 = _$createElement("div");
_$spread(_el$10, _$mergeProps(props, { get data() {
	var _el$15 = _$createElement("span");
	_$insert(_el$15, () => {
		return state.value;
	});
	return _el$15;
} }), false);
const spreadValue = _el$10;
var _el$11 = _$createElement("div");
_$insert(_el$11, _$createComponent(Comp, { get fallback() {
	var _el$16 = _$createElement("h1");
	_$insertNode(_el$16, _$createTextNode("fallback"));
	return _el$16;
} }));
const propValue = _el$11;
