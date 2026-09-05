import { template as _$template } from "r-dom";
import { ref as _$ref } from "r-dom";
var _tmpl$ = /* @__PURE__ */ _$template(`<div>`);
// Bare variables inside a ref array must be assigned at mount (#3285).
let elementRef;
var _el$ = _tmpl$();
_$ref(() => {
	return [(_ref$) => {
		var _ref$2 = elementRef;
		typeof _ref$2 === "function" ? _ref$2(_ref$) : elementRef = _ref$;
	}];
}, _el$);
const el1 = _el$;
// Multiple bare variables, each gets its own assignment callback.
let a, b;
var _el$2 = _tmpl$();
_$ref(() => {
	return [(_ref$3) => {
		var _ref$4 = a;
		typeof _ref$4 === "function" ? _ref$4(_ref$3) : a = _ref$3;
	}, (_ref$5) => {
		var _ref$6 = b;
		typeof _ref$6 === "function" ? _ref$6(_ref$5) : b = _ref$5;
	}];
}, _el$2);
const el2 = _el$2;
var _el$3 = _tmpl$();
_$ref(() => {
	return [(node) => calls.push(node)];
}, _el$3);
// Callback refs keep working and pass through untouched.
const el3 = _el$3;
// Member-expression targets are assignment callbacks too.
const holder = {};
var _el$4 = _tmpl$();
_$ref(() => {
	return [(_ref$7) => {
		var _ref$8 = holder.el;
		typeof _ref$8 === "function" ? _ref$8(_ref$7) : holder.el = _ref$7;
	}];
}, _el$4);
const el4 = _el$4;
// Nested arrays are recursed so runtime flattening reaches every callback.
let nested;
var _el$5 = _tmpl$();
_$ref(() => {
	return [[(_ref$9) => {
		var _ref$10 = nested;
		typeof _ref$10 === "function" ? _ref$10(_ref$9) : nested = _ref$9;
	}]];
}, _el$5);
const el5 = _el$5;
var _el$6 = _tmpl$();
_$ref(() => {
	return [
		null,
		undefined,
		false
	];
}, _el$6);
// Falsy/placeholder slots stay as-is (the runtime short-circuits them);
// globals like `undefined` are never treated as assignment targets.
const el6 = _el$6;
// A mutable binding that currently holds a function is *called*, not
// overwritten — same contract as the non-array lval ref branch.
let cb = () => {};
var _el$7 = _tmpl$();
_$ref(() => {
	return [(_ref$11) => {
		var _ref$12 = cb;
		typeof _ref$12 === "function" ? _ref$12(_ref$11) : cb = _ref$11;
	}];
}, _el$7);
const el7 = _el$7;
