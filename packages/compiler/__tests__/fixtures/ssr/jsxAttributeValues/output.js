import { escape as _$escape } from "r-server";
import { ssr as _$ssr } from "r-server";
import { ssrAttribute as _$ssrAttribute } from "r-server";
import { ssrGroup as _$ssrGroup } from "r-server";
import { ssrElement as _$ssrElement } from "r-server";
import { mergeProps as _$mergeProps } from "r-server";
var _tmpl$ = ["<div", ">after</div>"];
var _tmpl$2 = ["<div", "></div>"];
var _tmpl$3 = [
	"<div",
	"",
	"></div>"
];
var _tmpl$4 = "<button>go</button>";
var _tmpl$5 = "<div></div>";
var _tmpl$6 = ["<span>", "</span>"];
var _tmpl$7 = ["<div>", "</div>"];
var _tmpl$8 = "<span>static</span>";
var _tmpl$9 = ["<label>", "</label>"];
var _tmpl$10 = "<span>own</span>";
var _tmpl$11 = "<h1>fallback</h1>";
var _v$ = () => {
	return _$ssrAttribute("data", _tmpl$8);
};
const staticValue = _$ssr(_tmpl$, _v$);
var _v$2 = () => {
	var _v$8;
	return _$ssrAttribute("data", (_v$8 = () => {
		return _$escape(state.value);
	}, _$ssr(_tmpl$6, _v$8)));
};
const dynamicValue = _$ssr(_tmpl$, _v$2);
var _v$3 = () => {
	return _$ssrAttribute("data", (() => _$escape(state.compute(), true))());
};
const iifeValue = _$ssr(_tmpl$2, _v$3);
var _g$ = _$ssrGroup(() => {
	var _v$9, _v$10;
	return [_$ssrAttribute("first", (_v$9 = () => {
		return _$escape(state.first);
	}, _$ssr(_tmpl$6, _v$9))), _$ssrAttribute("second", (_v$10 = () => {
		return _$escape(state.second);
	}, _$ssr(_tmpl$9, _v$10)))];
}, 2);
const multiValues = _$ssr(_tmpl$3, _g$, _g$);
const handlerValue = _$ssr(_tmpl$4);
var _ref$ = (el) => el.appendChild(_$ssr(_tmpl$10));
const refValue = _$ssr(_tmpl$5);
const spreadValue = _$ssrElement("div", _$mergeProps(props, { get data() {
	var _v$6 = () => {
		return _$escape(state.value);
	};
	return _$ssr(_tmpl$6, _v$6);
} }), undefined, false);
var _v$7 = _$escape(Comp({ get fallback() {
	return _$ssr(_tmpl$11);
} }));
const propValue = _$ssr(_tmpl$7, _v$7);
