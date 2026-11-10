import { escape as _$escape } from "r-server";
import { ssr as _$ssr } from "r-server";
import { ssrAttribute as _$ssrAttribute } from "r-server";
import { ssrClassName as _$ssrClassName } from "r-server";
import { ssrStyleProperties as _$ssrStyleProperties } from "r-server";
import { ssrGroup as _$ssrGroup } from "r-server";
import { ssrElement as _$ssrElement } from "r-server";
var _v$16, _v$17;
var _tmpl$ = "<svg width=\"400\" height=\"180\"><rect stroke-width=\"2\" x=\"50\" y=\"20\" rx=\"20\" ry=\"20\" width=\"150\" height=\"150\" style=\"fill:red;stroke:black;stroke-width:5;opacity:0.5\"></rect><linearGradient gradientTransform=\"rotate(25)\"><stop offset=\"0%\"></stop></linearGradient></svg>";
var _tmpl$2 = [
	"<svg width=\"400\" height=\"180\"><rect",
	"",
	"",
	"",
	" rx=\"20\" ry=\"20\" width=\"150\" height=\"150\" style=\"",
	"\"></rect></svg>"
];
var _tmpl$3 = ["<svg width=\"400\" height=\"180\">", "</svg>"];
var _tmpl$4 = "<rect x=\"50\" y=\"20\" width=\"150\" height=\"150\"></rect>";
var _tmpl$5 = ["<svg viewBox=\"0 0 160 40\" xmlns=\"http://www.w3.org/2000/svg\"><a", "><text x=\"10\" y=\"25\">MDN Web Docs</text></a></svg>"];
var _tmpl$6 = ["<svg viewBox=\"0 0 160 40\" xmlns=\"http://www.w3.org/2000/svg\"><text x=\"10\" y=\"25\">", "</text></svg>"];
var _tmpl$7 = ["<svg><style>", "</style><script>a &lt; b &amp;&amp; c<\/script></svg>"];
var _tmpl$8 = [
	"<math><style>",
	"</style><mtext><style>",
	"</style></mtext></math>"
];
var _tmpl$9 = "<g><style>a &lt; b</style></g>";
var _tmpl$10 = ["<svg>", "</svg>"];
var _tmpl$11 = ["<svg><foreignObject><style>", "</style></foreignObject></svg>"];
var _tmpl$12 = ["<math><annotation-xml encoding=\"text/html\"><style>", "</style></annotation-xml></math>"];
var _tmpl$13 = "<style>a < b && c</style>";
var _tmpl$14 = ["<style>", "</style>"];
const template = _$ssr(_tmpl$);
var _g$ = _$ssrGroup(() => {
	return [
		((_v$) => _v$ == null ? "" : _$ssrAttribute("class", _$ssrClassName(_v$)))(state.name),
		_$ssrAttribute("stroke-width", _$escape(state.width, true)),
		_$ssrAttribute("x", _$escape(state.x, true)),
		_$ssrAttribute("y", _$escape(state.y, true)),
		_$ssrStyleProperties("fill:", "red", "stroke:", "black", "stroke-width:", _$escape(props.stroke, true), "opacity:", .5)
	];
}, 5);
const template2 = _$ssr(_tmpl$2, _g$, _g$, _g$, _g$, _g$);
var _v$7 = _$ssrElement("rect", props, undefined, false);
const template3 = _$ssr(_tmpl$3, _v$7);
const template4 = _$ssr(_tmpl$4);
const template5 = _$ssr(_tmpl$4);
const template6 = Component({ get children() {
	return _$ssr(_tmpl$4);
} });
const template7 = _$ssr(_tmpl$5, _$ssrAttribute("xlink:href", _$escape(url, true)));
var _v$8 = _$escape(text);
const template8 = _$ssr(_tmpl$6, _v$8);
var _v$9 = _$escape(css);
// `<style>`/`<script>` under `<svg>`/`<math>` are ordinary elements: their text
// parses as markup, so it escapes. HTML-namespace ones stay raw text.
const foreignStyle = _$ssr(_tmpl$7, _v$9);
var _v$10 = _$escape(css), _v$11 = css;
const foreignMathStyle = _$ssr(_tmpl$8, _v$10, _v$11);
const foreignPartial = _$ssr(_tmpl$9);
var _v$12 = show && (_v$16 = _$escape(css), _$ssr(_tmpl$14, _v$16));
const foreignThroughExpression = _$ssr(_tmpl$10, _v$12);
var _v$13 = show ? (_v$17 = _$escape(css), _$ssr(_tmpl$14, _v$17)) : void 0;
const foreignThroughComponent = _$ssr(_tmpl$10, _v$13);
var _v$14 = css;
const htmlInForeignObject = _$ssr(_tmpl$11, _v$14);
var _v$15 = css;
const htmlAnnotation = _$ssr(_tmpl$12, _v$15);
const htmlStyle = _$ssr(_tmpl$13);
