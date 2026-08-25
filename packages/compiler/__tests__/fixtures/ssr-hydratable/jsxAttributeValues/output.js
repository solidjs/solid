import { escape as _$escape } from "r-server";
import { ssr as _$ssr } from "r-server";
import { ssrHydrationKey as _$ssrHydrationKey } from "r-server";
import { ssrAttribute as _$ssrAttribute } from "r-server";
import { ssrGroup as _$ssrGroup } from "r-server";
import { ssrElement as _$ssrElement } from "r-server";
import { mergeProps as _$mergeProps } from "r-server";
var _tmpl$ = [
	"<div",
	"",
	">after</div>"
];
var _tmpl$2 = [
	"<div",
	"",
	"></div>"
];
var _tmpl$3 = [
	"<div",
	"",
	"",
	"></div>"
];
var _tmpl$4 = ["<button", ">go</button>"];
var _tmpl$5 = ["<div", "></div>"];
var _tmpl$6 = [
	"<span",
	">",
	"</span>"
];
var _tmpl$7 = [
	"<div",
	">",
	"</div>"
];
var _tmpl$8 = ["<span", ">static</span>"];
var _tmpl$9 = [
	"<label",
	">",
	"</label>"
];
var _tmpl$10 = ["<span", ">own</span>"];
var _tmpl$11 = ["<h1", ">fallback</h1>"];
var _v$ = _$ssrHydrationKey(), _v$2 = () => {
	var _v$16;
	return _$ssrAttribute("data", (_v$16 = _$ssrHydrationKey(), _$ssr(_tmpl$8, _v$16)));
};
const staticValue = _$ssr(_tmpl$, _v$, _v$2);
var _v$3 = _$ssrHydrationKey(), _v$4 = () => {
	var _v$17, _v$18;
	return _$ssrAttribute("data", (_v$17 = _$ssrHydrationKey(), _v$18 = () => {
		return _$escape(state.value);
	}, _$ssr(_tmpl$6, _v$17, _v$18)));
};
const dynamicValue = _$ssr(_tmpl$, _v$3, _v$4);
var _v$5 = _$ssrHydrationKey(), _v$6 = () => {
	return _$ssrAttribute("data", (() => _$escape(state.compute(), true))());
};
const iifeValue = _$ssr(_tmpl$2, _v$5, _v$6);
var _v$7 = _$ssrHydrationKey(), _g$ = _$ssrGroup(() => {
	var _v$19, _v$20, _v$21, _v$22;
	return [_$ssrAttribute("first", (_v$19 = _$ssrHydrationKey(), _v$20 = () => {
		return _$escape(state.first);
	}, _$ssr(_tmpl$6, _v$19, _v$20))), _$ssrAttribute("second", (_v$21 = _$ssrHydrationKey(), _v$22 = () => {
		return _$escape(state.second);
	}, _$ssr(_tmpl$9, _v$21, _v$22)))];
}, 2);
const multiValues = _$ssr(_tmpl$3, _v$7, _g$, _g$);
var _v$10 = _$ssrHydrationKey();
const handlerValue = _$ssr(_tmpl$4, _v$10);
var _v$11 = _$ssrHydrationKey(), _ref$ = (el) => {
	var _v$23;
	return el.appendChild((_v$23 = _$ssrHydrationKey(), _$ssr(_tmpl$10, _v$23)));
};
const refValue = _$ssr(_tmpl$5, _v$11);
const spreadValue = _$ssrElement("div", () => {
	return _$mergeProps(props, { get data() {
		var _v$12 = _$ssrHydrationKey(), _v$13 = () => {
			return _$escape(state.value);
		};
		return _$ssr(_tmpl$6, _v$12, _v$13);
	} });
}, undefined, true);
var _v$14 = _$ssrHydrationKey(), _v$15 = _$escape(Comp({ get fallback() {
	var _v$24 = _$ssrHydrationKey();
	return _$ssr(_tmpl$11, _v$24);
} }));
const propValue = _$ssr(_tmpl$7, _v$14, _v$15);
