import { escape as _$escape } from "r-server";
import { ssr as _$ssr } from "r-server";
import { ssrHydrationKey as _$ssrHydrationKey } from "r-server";
import { ssrAttribute as _$ssrAttribute } from "r-server";
import { ssrClassName as _$ssrClassName } from "r-server";
import { ssrStyleProperty as _$ssrStyleProperty } from "r-server";
import { ssrGroup as _$ssrGroup } from "r-server";
import { ssrElement as _$ssrElement } from "r-server";
var _v$11, _v$12;
var _tmpl$ = ["<svg", " width=\"400\" height=\"180\"><rect stroke-width=\"2\" x=\"50\" y=\"20\" rx=\"20\" ry=\"20\" width=\"150\" height=\"150\" style=\"fill:red;stroke:black;stroke-width:5;opacity:0.5\"></rect><linearGradient gradientTransform=\"rotate(25)\"><stop offset=\"0%\"></stop></linearGradient></svg>"];
var _tmpl$2 = [
	"<svg",
	" width=\"400\" height=\"180\"><rect class=\"",
	"\"",
	"",
	"",
	" rx=\"20\" ry=\"20\" width=\"150\" height=\"150\" style=\"",
	"\"></rect></svg>"
];
var _tmpl$3 = [
	"<svg",
	" width=\"400\" height=\"180\">",
	"</svg>"
];
var _tmpl$4 = ["<rect", " x=\"50\" y=\"20\" width=\"150\" height=\"150\"></rect>"];
var _tmpl$5 = [
	"<svg",
	" viewBox=\"0 0 160 40\" xmlns=\"http://www.w3.org/2000/svg\"><a",
	"><text x=\"10\" y=\"25\">MDN Web Docs</text></a></svg>"
];
var _tmpl$6 = [
	"<svg",
	" viewBox=\"0 0 160 40\" xmlns=\"http://www.w3.org/2000/svg\"><text x=\"10\" y=\"25\">",
	"</text></svg>"
];
var _v$ = _$ssrHydrationKey();
const template = _$ssr(_tmpl$, _v$);
var _v$2 = _$ssrHydrationKey(), _g$ = _$ssrGroup(() => {
	return [
		_$ssrClassName(state.name),
		_$ssrAttribute("stroke-width", _$escape(state.width, true)),
		_$ssrAttribute("x", _$escape(state.x, true)),
		_$ssrAttribute("y", _$escape(state.y, true)),
		_$ssrStyleProperty("fill:", "red") + _$ssrStyleProperty(";stroke:", "black") + _$ssrStyleProperty(";stroke-width:", _$escape(props.stroke, true)) + _$ssrStyleProperty(";opacity:", .5)
	];
}, 5);
const template2 = _$ssr(_tmpl$2, _v$2, _g$, _g$, _g$, _g$, _g$);
var _v$8 = _$ssrHydrationKey(), _v$9 = _$ssrElement("rect", props, undefined, false);
const template3 = _$ssr(_tmpl$3, _v$8, _v$9);
var _v$10 = _$ssrHydrationKey();
const template4 = _$ssr(_tmpl$4, _v$10);
const template5 = (_v$11 = _$ssrHydrationKey(), _$ssr(_tmpl$4, _v$11));
const template6 = Component({ get children() {
	return _v$12 = _$ssrHydrationKey(), _$ssr(_tmpl$4, _v$12);
} });
var _v$13 = _$ssrHydrationKey();
const template7 = _$ssr(_tmpl$5, _v$13, _$ssrAttribute("xlink:href", _$escape(url, true)));
var _v$14 = _$ssrHydrationKey(), _v$15 = _$escape(text || " ");
const template8 = _$ssr(_tmpl$6, _v$14, _v$15);
