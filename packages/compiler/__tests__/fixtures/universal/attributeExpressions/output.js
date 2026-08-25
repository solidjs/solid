import { createTextNode as _$createTextNode } from "r-custom";
import { effect as _$effect } from "r-custom";
import { mergeProps as _$mergeProps } from "r-custom";
import { spread as _$spread } from "r-custom";
import { insertNode as _$insertNode } from "r-custom";
import { setProp as _$setProp } from "r-custom";
import { ref as _$ref } from "r-custom";
import { createElement as _$createElement } from "r-custom";
import { binding } from "somewhere";
function refFn() {}
const refConst = null;
const selected = true;
let link;
var _el$ = _$createElement("div");
var _el$2 = _$createElement("h1");
var _el$3 = _$createElement("a", {
	href: "/",
	readonly: value
});
_$insertNode(_el$, _el$2);
_$setProp(_el$, "id", "main");
_$spread(_el$, _$mergeProps(results, { style: { color } }), true);
_$insertNode(_el$2, _el$3);
_$setProp(_el$2, "class", "base");
_$spread(_el$2, _$mergeProps(results, {
	disabled: true,
	readonly: "",
	get title() {
		return welcoming();
	},
	get style() {
		return {
			"background-color": color(),
			"margin-right": "40px"
		};
	},
	get ["class"]() {
		return ["base", {
			dynamic: dynamic(),
			selected
		}];
	}
}), true);
_$insertNode(_el$3, _$createTextNode("Welcome"));
var _ref$ = link;
typeof _ref$ === "function" || Array.isArray(_ref$) ? _$ref(() => {
	return _ref$;
}, _el$3) : link = _el$3;
const template = _el$;
var _el$4 = _$createElement("div");
var _el$5 = _$createElement("div", { textContent: rowId });
var _el$6 = _$createElement("div");
var _el$7 = _$createElement("div", { innerHTML: "<div/>" });
_$insertNode(_el$4, _el$5);
_$insertNode(_el$4, _el$6);
_$insertNode(_el$4, _el$7);
_$spread(_el$4, _$mergeProps(() => {
	return getProps("test");
}), true);
_$effect(() => row.label, (_v$, _$p) => {
	_$setProp(_el$6, "textContent", _v$, _$p);
});
const template2 = _el$4;
var _el$8 = _$createElement("div", {
	id: /*@static*/ state.id,
	style: /*@static*/ { "background-color": state.color },
	textContent: /*@static*/ state.content
});
_$effect(() => state.name, (_v$, _$p) => {
	_$setProp(_el$8, "name", _v$, _$p);
});
const template3 = _el$8;
var _el$9 = _$createElement("div", { class: { "ccc:ddd": true } });
_$effect(() => state.class, (_v$, _$p) => {
	_$setProp(_el$9, "className", _v$, _$p);
});
const template4 = _el$9;
const template5 = _$createElement("div", {
	class: "a",
	className: "b"
});
var _el$11 = _$createElement("div", { textContent: "Hi" });
_$effect(() => someStyle(), (_v$, _$p) => {
	_$setProp(_el$11, "style", _v$, _$p);
});
const template6 = _el$11;
var _el$12 = _$createElement("div");
_$effect(() => ({
	"background-color": color(),
	"margin-right": "40px",
	...props.style
}), (_v$, _$p) => {
	_$setProp(_el$12, "style", _v$, _$p);
});
const template7 = _el$12;
let refTarget;
var _el$13 = _$createElement("div");
var _ref$2 = refTarget;
typeof _ref$2 === "function" || Array.isArray(_ref$2) ? _$ref(() => {
	return _ref$2;
}, _el$13) : refTarget = _el$13;
const template8 = _el$13;
var _el$14 = _$createElement("div");
_$ref(() => {
	return (e) => console.log(e);
}, _el$14);
const template9 = _el$14;
var _el$15 = _$createElement("div");
var _ref$3 = refFactory();
(typeof _ref$3 === "function" || Array.isArray(_ref$3)) && _$ref(() => {
	return _ref$3;
}, _el$15);
const template10 = _el$15;
const template12 = _$createElement("div", { "prop:htmlFor": thing });
const template13 = _$createElement("input", {
	type: "checkbox",
	checked: true
});
var _el$18 = _$createElement("input", { type: "checkbox" });
_$effect(() => state.visible, (_v$, _$p) => {
	_$setProp(_el$18, "checked", _v$, _$p);
});
const template14 = _el$18;
var _el$19 = _$createElement("div", { class: "`a" });
_$insertNode(_el$19, _$createTextNode("`$`"));
const template15 = _el$19;
var _el$20 = _$createElement("button", {
	class: ["static", { hi: "k" }],
	type: "button"
});
_$insertNode(_el$20, _$createTextNode("Write"));
const template16 = _el$20;
var _el$21 = _$createElement("button", {
	class: {
		a: true,
		b: true,
		c: true
	},
	onClick: increment
});
_$insertNode(_el$21, _$createTextNode("Hi"));
const template17 = _el$21;
var _el$22 = _$createElement("div");
_$spread(_el$22, _$mergeProps(() => {
	return { get [key()]() {
		return props.value;
	} };
}), false);
const template18 = _el$22;
var _el$23 = _$createElement("div");
_$effect(() => ({
	a: "static",
	...rest
}), (_v$, _$p) => {
	_$setProp(_el$23, "style", _v$, _$p);
});
const template19 = _el$23;
var _el$24 = _$createElement("div");
var _ref$4 = a().b.c;
typeof _ref$4 === "function" || Array.isArray(_ref$4) ? _$ref(() => {
	return _ref$4;
}, _el$24) : a().b.c = _el$24;
const template21 = _el$24;
var _el$25 = _$createElement("div");
var _ref$5 = a().b?.c;
(typeof _ref$5 === "function" || Array.isArray(_ref$5)) && _$ref(() => {
	return _ref$5;
}, _el$25);
const template22 = _el$25;
var _el$26 = _$createElement("div");
var _ref$6 = a() ? b : c;
(typeof _ref$6 === "function" || Array.isArray(_ref$6)) && _$ref(() => {
	return _ref$6;
}, _el$26);
const template23 = _el$26;
var _el$27 = _$createElement("div");
var _ref$7 = a() ?? b;
(typeof _ref$7 === "function" || Array.isArray(_ref$7)) && _$ref(() => {
	return _ref$7;
}, _el$27);
const template24 = _el$27;
var _el$28 = _$createElement("div");
_$ref(() => {
	return binding;
}, _el$28);
const template25 = _el$28;
var _el$29 = _$createElement("div");
var _ref$8 = binding.prop;
typeof _ref$8 === "function" || Array.isArray(_ref$8) ? _$ref(() => {
	return _ref$8;
}, _el$29) : binding.prop = _el$29;
const template26 = _el$29;
var _el$30 = _$createElement("div");
var _ref$9 = refFn;
typeof _ref$9 === "function" || Array.isArray(_ref$9) ? _$ref(() => {
	return _ref$9;
}, _el$30) : refFn = _el$30;
const template27 = _el$30;
var _el$31 = _$createElement("div");
_$ref(() => {
	return refConst;
}, _el$31);
const template28 = _el$31;
var _el$32 = _$createElement("div");
var _ref$10 = refUnknown;
typeof _ref$10 === "function" || Array.isArray(_ref$10) ? _$ref(() => {
	return _ref$10;
}, _el$32) : refUnknown = _el$32;
const template29 = _el$32;
