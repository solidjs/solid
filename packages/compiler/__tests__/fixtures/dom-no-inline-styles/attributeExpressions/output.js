import { template as _$template } from "r-dom";
import { style as _$style } from "r-dom";
import { effect as _$effect } from "r-dom";
var _tmpl$ = /* @__PURE__ */ _$template(`<div>`);
var _el$ = _tmpl$();
_$effect(() => {
	return `color: red`;
}, (_v$, _$p) => {
	_$style(_el$, _v$, _$p);
});
const template1 = _el$;
var _el$2 = _tmpl$();
_$effect(() => {
	return someStyle();
}, (_v$, _$p) => {
	_$style(_el$2, _v$, _$p);
});
const template2 = _el$2;
var _el$3 = _tmpl$();
_$effect(() => {
	return { color: "red" };
}, (_v$, _$p) => {
	_$style(_el$3, _v$, _$p);
});
const template3 = _el$3;
var _el$4 = _tmpl$();
_$effect(() => {
	return {
		"background-color": color(),
		"margin-right": "40px"
	};
}, (_v$, _$p) => {
	_$style(_el$4, _v$, _$p);
});
const template4 = _el$4;
var _el$5 = _tmpl$();
_$effect(() => {
	return {
		background: "red",
		color: "green",
		margin: 3,
		padding: .4
	};
}, (_v$, _$p) => {
	_$style(_el$5, _v$, _$p);
});
const template5 = _el$5;
var _el$6 = _tmpl$();
_$effect(() => {
	return {
		background: "red",
		color: "green",
		border: signal()
	};
}, (_v$, _$p) => {
	_$style(_el$6, _v$, _$p);
});
const template6 = _el$6;
var _el$7 = _tmpl$();
_$effect(() => {
	return {
		background: "red",
		color: "green",
		border: undefined
	};
}, (_v$, _$p) => {
	_$style(_el$7, _v$, _$p);
});
const template7 = _el$7;
var _el$8 = _tmpl$();
_$effect(() => {
	return {};
}, (_v$, _$p) => {
	_$style(_el$8, _v$, _$p);
});
const template8 = _el$8;
