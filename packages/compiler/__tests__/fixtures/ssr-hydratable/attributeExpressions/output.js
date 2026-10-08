import { memo as _$memo } from "r-server";
import { scope as _$scope } from "r-server";
import { escape as _$escape } from "r-server";
import { ssr as _$ssr } from "r-server";
import { ssrHydrationKey as _$ssrHydrationKey } from "r-server";
import { ssrSelectValues as _$ssrSelectValues } from "r-server";
import { ssrAttribute as _$ssrAttribute } from "r-server";
import { ssrClassName as _$ssrClassName } from "r-server";
import { ssrStyle as _$ssrStyle } from "r-server";
import { ssrStyleProperty as _$ssrStyleProperty } from "r-server";
import { ssrStyleProperties as _$ssrStyleProperties } from "r-server";
import { ssrGroup as _$ssrGroup } from "r-server";
import { ssrElement as _$ssrElement } from "r-server";
import { ssrElementAttribute as _$ssrElementAttribute } from "r-server";
import { ssrLinkClaim as _$ssrLinkClaim } from "r-server";
var _ref$, _v$, _v$2, _v$49, _v$51, _v$53, _v$55, _v$56, _v$58;
var _tmpl$ = [
	"<a href=\"/\" class=\"",
	"\"",
	">Welcome</a>"
];
var _tmpl$2 = ["<div>", "</div>"];
var _tmpl$3 = "<div><div/></div>";
var _tmpl$4 = [
	"<div",
	" foo",
	" style=\"",
	"\"",
	">",
	"</div>"
];
var _tmpl$5 = [
	"<div",
	"",
	" class=\"",
	"\"></div>"
];
var _tmpl$6 = ["<div", " class=\"a\" className=\"b\"></div>"];
var _tmpl$7 = [
	"<div",
	"",
	">Hi</div>"
];
var _tmpl$8 = [
	"<div",
	" style=\"",
	"\" class=\"",
	"\"></div>"
];
var _tmpl$9 = ["<div", "></div>"];
var _tmpl$10 = ["<div", " onclick=\"console.log('hi')\"></div>"];
var _tmpl$11 = ["<input", " type=\"checkbox\" checked>"];
var _tmpl$12 = [
	"<input",
	" type=\"checkbox\"",
	">"
];
var _tmpl$13 = ["<div", " class=\"`a\">`$`</div>"];
var _tmpl$14 = [
	"<button",
	"",
	" type=\"button\">Write</button>"
];
var _tmpl$15 = [
	"<button",
	" class=\"",
	"\">Hi</button>"
];
var _tmpl$16 = [
	"<div",
	"",
	"></div>"
];
var _tmpl$17 = [
	"<div",
	"><input",
	"",
	"",
	" readonly><input",
	"",
	"",
	"",
	"></div>"
];
var _tmpl$18 = [
	"<div",
	" style=\"",
	"\"></div>"
];
var _tmpl$19 = ["<div", " data=\"&quot;hi&quot;\" data2=\"&quot;\"></div>"];
var _tmpl$20 = [
	"<div",
	"",
	">",
	"</div>"
];
var _tmpl$21 = [
	"<div",
	"><!--$-->",
	"<!--/-->",
	"</div>"
];
var _tmpl$22 = ["<div", " class=\"class1 class2 class3 class4 class5 class6\" style=\"color:red;background-color:blue !important;border:1px solid black;font-size:12px;\" random=\"random1 random2\n    random3 random4\"></div>"];
var _tmpl$23 = [
	"<button",
	"",
	"></button>"
];
var _tmpl$24 = ["<input", " value=\"10\">"];
var _tmpl$25 = [
	"<select",
	"",
	"><option",
	">Red</option><option",
	">Blue</option></select>"
];
var _tmpl$26 = ["<img", " src>"];
var _tmpl$27 = ["<div", "><img src></div>"];
var _tmpl$28 = ["<img", " src loading=\"lazy\">"];
var _tmpl$29 = ["<div", "><img src loading=\"lazy\"></div>"];
var _tmpl$30 = ["<iframe", " src></iframe>"];
var _tmpl$31 = ["<div", "><iframe src></iframe></div>"];
var _tmpl$32 = ["<iframe", " src loading=\"lazy\"></iframe>"];
var _tmpl$33 = ["<div", "><iframe src loading=\"lazy\"></iframe></div>"];
var _tmpl$34 = ["<div", " title=\"&lt;u>data&lt;/u>\"></div>"];
var _tmpl$35 = ["<div", " true truestr=\"true\" truestrjs=\"true\"></div>"];
var _tmpl$36 = ["<div", " falsestr=\"false\" falsestrjs=\"false\"></div>"];
var _tmpl$37 = ["<div", " true></div>"];
var _tmpl$38 = [
	"<div",
	" a b c d f=\"0\" g h",
	"",
	"",
	" l></div>"
];
var _tmpl$39 = ["<math", " display=\"block\"><mrow></mrow></math>"];
var _tmpl$40 = ["<mrow", "><mi>x</mi><mo>=</mo></mrow>"];
var _tmpl$41 = [
	"<video",
	"",
	"></video>"
];
var _tmpl$42 = ["<video", " playsinline></video>"];
var _tmpl$43 = ["<video", "></video>"];
var _tmpl$44 = ["<video", " poster=\"1.jpg\"></video>"];
var _tmpl$45 = ["<div", "><video poster=\"1.jpg\"></video></div>"];
var _tmpl$46 = ["<div", "><video></video></div>"];
var _tmpl$47 = [
	"<div",
	" style=\"",
	"\"",
	"></div>"
];
var _tmpl$48 = [
	"<button",
	" type=\"button\"",
	"",
	"",
	">",
	"</button>"
];
var _tmpl$49 = [
	"<div",
	"><video muted></video><video></video><video></video><video muted></video><video",
	"></video><video src=\"test.mp4\" muted></video></div>"
];
var _tmpl$50 = ["<video", " src=\"test.mp4\" muted></video>"];
var _tmpl$51 = [
	"<div",
	"><div>",
	"</div><div>",
	"</div><input type=\"checkbox\"",
	"></div>"
];
var _tmpl$52 = [
	"<div",
	"><textarea>",
	"</textarea><textarea>",
	"</textarea><!--$-->",
	"<!--/--></div>"
];
var _tmpl$53 = [
	"<div",
	"",
	"",
	"",
	"></div>"
];
var _tmpl$54 = ["<div", " class></div>"];
var _lk$ = { href: "/" };
var _sk$ = (k) => k === "foo" || k === "disabled" || k === "title" || k === "style" || k === "class";
var _sk$2 = (k) => k === "class" || k === "style";
var _sk$3 = (k) => k === "something";
var _sk$4 = (k) => k === "data-dynamic" || k === "data-static";
var _sk$5 = (k) => k === "stroke-width" || k === "fill";
var _sk$6 = (k) => k === "class" || k === "data-kind";
var _sk$7 = (k) => k === "class" || k === "data-id";
var _sk$8 = (k) => k === "id";
var _sk$9 = (k) => k === "disabled" || k === "type" || k === "tabindex" || k === "style";
_$ssrSelectValues();
import * as styles from "./styles.module.css";
import { binding } from "somewhere";
function refFn() {}
const refConst = null;
const selected = true;
let id = "my-h1";
let link;
const template = _$ssrElement("div", [{ id: "main" }, results], () => {
	return _$ssrElement("h1", [{ id }, results], () => {
		return _ref$ = link, _$ssr(_tmpl$, "ccc ddd", _$ssrLinkClaim(_lk$));
	}, false, _sk$, () => " foo disabled" + _$ssrElementAttribute("title", welcoming()) + _$ssrElementAttribute("style", {
		"background-color": color(),
		"margin-right": "40px"
	}) + _$ssrElementAttribute("class", ["base", {
		dynamic: dynamic(),
		selected
	}]));
}, true, _sk$2, () => _$ssrElementAttribute("class", { selected: unknown }) + _$ssrElementAttribute("style", { color }));
const template2 = _$ssrElement("div", getProps("test"), () => {
	return [
		(_v$ = _$escape(rowId || " "), _$ssr(_tmpl$2, _v$)),
		(_v$2 = () => {
			return _$escape(row.label || " ");
		}, _$ssr(_tmpl$2, _v$2)),
		_$ssr(_tmpl$3)
	];
}, true);
var _v$3 = _$ssrHydrationKey(), _g$ = _$ssrGroup(() => {
	return [_$ssrAttribute("name", _$escape(state.name, true)), _$escape(state.content || " ")];
}, 2);
const template3 = _$ssr(_tmpl$4, _v$3, _$ssrAttribute(
	"id",
	/*@static*/
	_$escape(state.id, true)
), _$ssrStyleProperty("background-color:", _$escape(state.color, true)), _g$, _g$);
var _v$6 = _$ssrHydrationKey(), _v$7 = () => {
	return _$ssrAttribute("className", _$escape(state.class, true));
};
const template4 = _$ssr(_tmpl$5, _v$6, _v$7, "ccc:ddd");
var _v$8 = _$ssrHydrationKey();
const template5 = _$ssr(_tmpl$6, _v$8);
var _v$9 = _$ssrHydrationKey(), _v$11 = () => {
	return ((_v$10) => _v$10 == null ? "" : _$ssrAttribute("style", _$ssrStyle(_v$10)))(someStyle());
};
const template6 = _$ssr(_tmpl$7, _v$9, _v$11);
let undefVar;
var _v$12 = _$ssrHydrationKey(), _v$13 = () => {
	return _$ssrStyle({
		"background-color": color(),
		"margin-right": "40px",
		...props.style
	});
};
const template7 = _$ssr(_tmpl$8, _v$12, _v$13, undefVar ? "other-class2" : "");
let refTarget;
var _v$14 = _$ssrHydrationKey(), _ref$2 = refTarget;
const template8 = _$ssr(_tmpl$9, _v$14);
var _v$15 = _$ssrHydrationKey(), _ref$3 = (e) => console.log(e);
const template9 = _$ssr(_tmpl$9, _v$15);
var _v$16 = _$ssrHydrationKey(), _ref$4 = refFactory();
const template10 = _$ssr(_tmpl$9, _v$16);
var _v$17 = _$ssrHydrationKey();
const template12 = _$ssr(_tmpl$10, _v$17);
var _v$18 = _$ssrHydrationKey();
const template13 = _$ssr(_tmpl$11, _v$18);
var _v$19 = _$ssrHydrationKey(), _v$20 = () => {
	return _$ssrAttribute("checked", _$escape(state.visible, true));
};
const template14 = _$ssr(_tmpl$12, _v$19, _v$20);
var _v$21 = _$ssrHydrationKey();
const template15 = _$ssr(_tmpl$13, _v$21);
var _v$22 = _$ssrHydrationKey();
const template16 = _$ssr(_tmpl$14, _v$22, ((_v$23) => _v$23 == null ? "" : _$ssrAttribute("class", _$ssrClassName(_v$23)))(["static", { hi: "k" }]));
var _v$24 = _$ssrHydrationKey();
const template17 = _$ssr(_tmpl$15, _v$24, "a  b  c");
const template18 = _$ssrElement("div", { get [key()]() {
	return props.value;
} }, undefined, true);
var _v$25 = _$ssrHydrationKey();
const template19 = _$ssr(_tmpl$16, _v$25, ((_v$26) => _v$26 == null ? "" : _$ssrAttribute("class", _$ssrClassName(_v$26)))([{ "bg-red-500": true }, "flex flex-col"]));
var _v$27 = _$ssrHydrationKey(), _g$3 = _$ssrGroup(() => {
	return [_$ssrAttribute("min", _$escape(min(), true)), _$ssrAttribute("max", _$escape(max(), true))];
}, 2), _g$2 = _$ssrGroup(() => {
	return [_$ssrAttribute("min", _$escape(min(), true)), _$ssrAttribute("max", _$escape(max(), true))];
}, 2), _v$28 = () => {
	return _$ssrAttribute("value", _$escape(s(), true));
}, _v$31 = () => {
	return _$ssrAttribute("checked", _$escape(s2(), true));
};
const template20 = _$ssr(_tmpl$17, _v$27, _v$28, _g$3, _g$3, _v$31, _g$2, _g$2, _$ssrAttribute("readonly", _$escape(value, true)));
var _v$34 = _$ssrHydrationKey(), _v$35 = () => {
	return _$ssrStyle({
		a: "static",
		...rest
	});
};
const template21 = _$ssr(_tmpl$18, _v$34, _v$35);
var _v$36 = _$ssrHydrationKey();
const template22 = _$ssr(_tmpl$19, _v$36);
var _v$37 = _$ssrHydrationKey(), _v$38 = () => {
	return _$ssrAttribute("disabled", "t" in _$escape(test, true));
}, _v$39 = () => {
	return "t" in test && "true";
};
const template23 = _$ssr(_tmpl$20, _v$37, _v$38, _v$39);
const template24 = _$ssrElement("a", props, undefined, true, _sk$3, " something");
var _v$40 = _$ssrHydrationKey(), _v$41 = _$scope(() => {
	return _$escape(props.children);
}), _v$42 = _$ssrElement("a", props, undefined, false, _sk$3, " something");
const template25 = _$ssr(_tmpl$21, _v$40, _v$41, _v$42);
const template26 = _$ssrElement("div", [{
	start: "Hi",
	middle
}, spread], () => {
	return "Hi";
}, true);
const template27 = _$ssrElement("div", [
	{ start: "Hi" },
	first,
	{ middle },
	second
], () => {
	return "Hi";
}, true);
const template28 = _$ssrElement("label", api(), () => {
	return [
		_$ssrElement("span", api(), () => {
			return [
				"Input is ",
				"<!--$-->",
				() => {
					return api() ? "checked" : "unchecked";
				},
				"<!--/-->"
			];
		}, false),
		_$ssrElement("input", api(), undefined, false),
		_$ssrElement("div", api(), undefined, false)
	];
}, true);
var _v$43 = _$ssrHydrationKey(), _v$44 = !!someValue;
const template29 = _$ssr(_tmpl$20, _v$43, _$ssrAttribute("attribute", !!someValue), _v$44);
var _v$45 = _$ssrHydrationKey();
const template30 = _$ssr(_tmpl$22, _v$45);
var _v$46 = _$ssrHydrationKey(), _v$47 = () => {
	return _$ssrStyleProperty("background-color:", _$escape(getStore.itemProperties.color, true));
};
const template31 = _$ssr(_tmpl$18, _v$46, _v$47);
var _v$48 = _$ssrHydrationKey();
const template32 = _$ssr(_tmpl$18, _v$48, _$ssrStyleProperty("background-color:", _$escape(undefined, true)));
const template33 = [
	(_v$49 = _$ssrHydrationKey(), _$ssr(_tmpl$23, _v$49, ((_v$50) => _v$50 == null ? "" : _$ssrAttribute("class", _$ssrClassName(_v$50)))(styles.button))),
	(_v$51 = _$ssrHydrationKey(), _$ssr(_tmpl$23, _v$51, ((_v$52) => _v$52 == null ? "" : _$ssrAttribute("class", _$ssrClassName(_v$52)))(styles["foo--bar"]))),
	(_v$53 = _$ssrHydrationKey(), _v$55 = () => {
		return ((_v$54) => _v$54 == null ? "" : _$ssrAttribute("class", _$ssrClassName(_v$54)))(styles.foo.bar);
	}, _$ssr(_tmpl$23, _v$53, _v$55)),
	(_v$56 = _$ssrHydrationKey(), _v$58 = () => {
		return ((_v$57) => _v$57 == null ? "" : _$ssrAttribute("class", _$ssrClassName(_v$57)))(styles[foo()]);
	}, _$ssr(_tmpl$23, _v$56, _v$58))
];
var _v$59 = _$ssrHydrationKey(), _ref$5 = a().b.c;
const template35 = _$ssr(_tmpl$9, _v$59);
var _v$60 = _$ssrHydrationKey(), _ref$6 = a().b?.c;
const template36 = _$ssr(_tmpl$9, _v$60);
var _v$61 = _$ssrHydrationKey(), _ref$7 = a() ? b : c;
const template37 = _$ssr(_tmpl$9, _v$61);
var _v$62 = _$ssrHydrationKey(), _ref$8 = a() ?? b;
const template38 = _$ssr(_tmpl$9, _v$62);
var _v$63 = _$ssrHydrationKey();
const template39 = _$ssr(_tmpl$24, _v$63);
var _v$64 = _$ssrHydrationKey(), _v$65 = () => {
	return _$ssrStyleProperty("color:", _$escape(a(), true));
};
const template40 = _$ssr(_tmpl$18, _v$64, _v$65);
var _v$66 = _$ssrHydrationKey(), _v$67 = () => {
	return _$ssrAttribute("value", _$escape(state.color, true));
}, _v$68 = () => {
	return _$ssrAttribute("value", _$escape(Color.Red, true));
}, _v$69 = () => {
	return _$ssrAttribute("value", _$escape(Color.Blue, true));
};
const template41 = _$ssr(_tmpl$25, _v$66, _v$67, _v$68, _v$69);
var _v$70 = _$ssrHydrationKey();
const template42 = _$ssr(_tmpl$26, _v$70);
var _v$71 = _$ssrHydrationKey();
const template43 = _$ssr(_tmpl$27, _v$71);
var _v$72 = _$ssrHydrationKey();
const template44 = _$ssr(_tmpl$28, _v$72);
var _v$73 = _$ssrHydrationKey();
const template45 = _$ssr(_tmpl$29, _v$73);
var _v$74 = _$ssrHydrationKey();
const template46 = _$ssr(_tmpl$30, _v$74);
var _v$75 = _$ssrHydrationKey();
const template47 = _$ssr(_tmpl$31, _v$75);
var _v$76 = _$ssrHydrationKey();
const template48 = _$ssr(_tmpl$32, _v$76);
var _v$77 = _$ssrHydrationKey();
const template49 = _$ssr(_tmpl$33, _v$77);
var _v$78 = _$ssrHydrationKey();
const template50 = _$ssr(_tmpl$34, _v$78);
var _v$79 = _$ssrHydrationKey(), _ref$9 = binding;
const template51 = _$ssr(_tmpl$9, _v$79);
var _v$80 = _$ssrHydrationKey(), _ref$10 = binding.prop;
const template52 = _$ssr(_tmpl$9, _v$80);
var _v$81 = _$ssrHydrationKey(), _ref$11 = refFn;
const template53 = _$ssr(_tmpl$9, _v$81);
var _v$82 = _$ssrHydrationKey(), _ref$12 = refConst;
const template54 = _$ssr(_tmpl$9, _v$82);
var _v$83 = _$ssrHydrationKey(), _ref$13 = refUnknown;
const template55 = _$ssr(_tmpl$9, _v$83);
var _v$84 = _$ssrHydrationKey();
const template56 = _$ssr(_tmpl$35, _v$84);
var _v$85 = _$ssrHydrationKey();
const template57 = _$ssr(_tmpl$36, _v$85);
var _v$86 = _$ssrHydrationKey();
const template58 = _$ssr(_tmpl$9, _v$86);
var _v$87 = _$ssrHydrationKey();
const template59 = _$ssr(_tmpl$37, _v$87);
var _v$88 = _$ssrHydrationKey();
const template60 = _$ssr(_tmpl$38, _v$88, _$ssrAttribute("i", _$escape(undefined, true)), _$ssrAttribute("j", _$escape(null, true)), _$ssrAttribute("k", void 0));
var _v$89 = _$ssrHydrationKey();
const template61 = _$ssr(_tmpl$39, _v$89);
var _v$90 = _$ssrHydrationKey();
const template62 = _$ssr(_tmpl$40, _v$90);
var _v$91 = _$ssrHydrationKey();
const template63 = _$ssr(_tmpl$18, _v$91, _$ssrStyleProperty("background:", "red"));
var _v$92 = _$ssrHydrationKey();
const template64 = _$ssr(_tmpl$18, _v$92, _$ssrStyleProperties("background:", "red", "color:", "green", "margin:", 3, "padding:", .4));
var _v$93 = _$ssrHydrationKey();
const template65 = _$ssr(_tmpl$18, _v$93, _$ssrStyleProperties("background:", "red", "color:", "green", "border:", _$escape(undefined, true)));
var _v$94 = _$ssrHydrationKey(), _v$95 = () => {
	return _$ssrStyleProperties("background:", "red", "color:", "green", "border:", _$escape(signal(), true));
};
const template66 = _$ssr(_tmpl$18, _v$94, _v$95);
var _v$96 = _$ssrHydrationKey();
const template67 = _$ssr(_tmpl$18, _v$96, _$ssrStyleProperties("background:", "red", "color:", "green", "border:", _$escape(somevalue, true)));
var _v$97 = _$ssrHydrationKey(), _v$98 = () => {
	return _$ssrStyleProperties("background:", "red", "color:", "green", "border:", _$escape(some.access, true));
};
const template68 = _$ssr(_tmpl$18, _v$97, _v$98);
var _v$99 = _$ssrHydrationKey();
const template69 = _$ssr(_tmpl$18, _v$99, _$ssrStyleProperties("background:", "red", "color:", "green", "border:", _$escape(null, true)));
var _v$100 = _$ssrHydrationKey();
const template70 = _$ssr(_tmpl$41, _v$100, _$ssrAttribute("playsinline", _$escape(value, true)));
var _v$101 = _$ssrHydrationKey();
const template71 = _$ssr(_tmpl$42, _v$101);
var _v$102 = _$ssrHydrationKey();
const template72 = _$ssr(_tmpl$43, _v$102);
var _v$103 = _$ssrHydrationKey();
const template73 = _$ssr(_tmpl$44, _v$103);
var _v$104 = _$ssrHydrationKey();
const template74 = _$ssr(_tmpl$45, _v$104);
var _v$105 = _$ssrHydrationKey();
const template75 = _$ssr(_tmpl$43, _v$105);
var _v$106 = _$ssrHydrationKey();
const template76 = _$ssr(_tmpl$46, _v$106);
var _v$107 = _$ssrHydrationKey();
// STATIC TESTS
const template77 = _$ssr(_tmpl$18, _v$107, _$ssrStyleProperties("width:", _$escape(props.width, true), "height:", _$escape(props.height, true)));
var _v$108 = _$ssrHydrationKey(), _v$109 = () => {
	return _$ssrAttribute("something", _$escape(color(), true));
};
const template78 = _$ssr(_tmpl$47, _v$108, _$ssrStyleProperties("width:", _$escape(props.width, true), "height:", _$escape(props.height, true)), _v$109);
var _v$110 = _$ssrHydrationKey(), _v$111 = () => {
	return _$ssrStyleProperties(
		"width:",
		_$escape(props.width, true),
		"height:",
		/* @static */
		_$escape(props.height, true)
	);
};
const template79 = _$ssr(_tmpl$47, _v$110, _v$111, _$ssrAttribute(
	"something",
	/*@static*/
	_$escape(color(), true)
));
// STATIC TESTS SPREADS
const propsSpread = {
	something: color(),
	style: {
		"background-color": color(),
		color: /* @static*/ color(),
		"margin-right": /* @static */ props.right
	}
};
const template80 = _$ssrElement("div", propsSpread, undefined, true);
const template81 = _$ssrElement("div", propsSpread, undefined, true);
const template82 = _$ssrElement("div", propsSpread, undefined, true, _sk$4, () => _$ssrElementAttribute("data-dynamic", color()) + _$ssrElementAttribute(
	"data-static",
	/* @static */
	color()
));
const template83 = _$ssrElement("div", propsSpread, undefined, true, _sk$4, () => _$ssrElementAttribute("data-dynamic", color()) + _$ssrElementAttribute(
	"data-static",
	/* @static */
	color()
));
const template84 = _$ssrElement("div", [
	propsSpread1,
	propsSpread2,
	propsSpread3
], undefined, true, _sk$4, () => _$ssrElementAttribute("data-dynamic", color()) + _$ssrElementAttribute(
	"data-static",
	/* @static */
	color()
));
// STATIC PROPERTY OF OBJECT ACCESS
// https://github.com/ryansolid/dom-expressions/issues/252#issuecomment-1572220563
const styleProp = { style: {
	width: props.width,
	height: props.height
} };
var _v$112 = _$ssrHydrationKey();
const template85 = _$ssr(_tmpl$16, _v$112, ((_v$113) => _v$113 == null ? "" : _$ssrAttribute("style", _$ssrStyle(_v$113)))(
	/* @static */
	styleProp.style
));
var _v$114 = _$ssrHydrationKey(), _v$116 = () => {
	return ((_v$115) => _v$115 == null ? "" : _$ssrAttribute("style", _$ssrStyle(_v$115)))(styleProp.style);
};
const template86 = _$ssr(_tmpl$16, _v$114, _v$116);
const style = {
	background: "red",
	border: "solid black " + count() + "px"
};
var _v$117 = _$ssrHydrationKey(), _v$118 = () => {
	return _$ssrAttribute("aria-label", _$escape(count(), true));
}, _v$121 = _$scope(() => {
	return _$escape(count());
});
const template87 = _$ssr(_tmpl$48, _v$117, _v$118, ((_v$119) => _v$119 == null ? "" : _$ssrAttribute("style", _$ssrStyle(_v$119)))(style), ((_v$120) => _v$120 == null ? "" : _$ssrAttribute("class", _$ssrClassName(_v$120)))(style), _v$121);
var _v$122 = _$ssrHydrationKey(), _v$123 = () => {
	return _$ssrAttribute("aria-label", _$escape(count(), true));
}, _v$126 = _$scope(() => {
	return _$escape(count());
});
const template88 = _$ssr(_tmpl$48, _v$122, _v$123, ((_v$124) => _v$124 == null ? "" : _$ssrAttribute("style", _$ssrStyle(_v$124)))(
	/* @static*/
	style
), ((_v$125) => _v$125 == null ? "" : _$ssrAttribute("class", _$ssrClassName(_v$125)))(
	/* @static*/
	style
), _v$126);
var _v$127 = _$ssrHydrationKey();
const template89 = _$ssr(_tmpl$9, _v$127);
var _v$128 = _$ssrHydrationKey(), _v$129 = () => {
	return _$ssrAttribute("data-test", _$escape(state.flag || undefined, true));
};
const template90 = _$ssr(_tmpl$16, _v$128, _v$129);
var _v$130 = _$ssrHydrationKey(), _v$131 = () => {
	return _$ssrAttribute("muted", _$escape(dynamicAttribute(), true));
};
const template91 = _$ssr(_tmpl$49, _v$130, _v$131);
function MyVideo() {
	var _v$132 = _$ssrHydrationKey();
	return _$ssr(_tmpl$50, _v$132);
}
// #2959: conditional attribute merged into a spread stays a bare expression
// (parity with the dom generate — neither side allocates a hydration id).
const template97 = _$ssrElement("svg", spread, undefined, true, _sk$5, () => _$ssrElementAttribute("stroke-width", cond() ? width() : 2) + _$ssrElementAttribute("fill", cond() && color()));
var _v$133 = _$ssrHydrationKey(), _v$134 = () => {
	return createIcon(props.radius);
}, _v$135 = () => {
	return _$escape(getLabel(props.id) || " ");
}, _v$136 = () => {
	return _$ssrAttribute("checked", _$escape(checked(), true));
};
// solidjs/solid#3015: innerHTML/textContent redirects are opaque content — a
// call-shaped value must not get the _$scope id reservation (the client
// applies these as plain prop effects that never allocate hydration ids), or
// every hydratable sibling after it shifts by one id.
const template98 = _$ssr(_tmpl$51, _v$133, _v$134, _v$135, _v$136);
var _v$137 = _$ssrHydrationKey(), _v$138 = () => {
	return _$escape(text());
}, _v$139 = () => {
	return _$escape(initial());
}, _v$140 = _$escape(Counter({}));
// solidjs/solid#3691: a textarea's dynamic value/defaultValue folds into its
// text content on the server, but the client writes it as a plain `value`
// property effect that never allocates a hydration id — the fold must not take
// the _$scope reservation either, or the component after it hydrates one id off.
const template99 = _$ssr(_tmpl$52, _v$137, _v$138, _v$139, _v$140);
// Static attributes after the last spread bake into ssrElement's attribute
// string with their keys skipped on the spread; statics before a spread, and
// anything between two spreads, stay a source the spread can override.
const template110 = _$ssrElement("li", spread, undefined, true, _sk$6, " class=\"row\" data-kind=\"item\"");
const template111 = _$ssrElement("li", [{
	class: "row",
	"data-kind": "item"
}, spread], undefined, true);
const template112 = _$ssrElement("li", spread, () => {
	return _$scope(() => {
		return _$escape(dynamicContent());
	});
}, true, _sk$7, () => " class=\"row\"" + _$ssrElementAttribute("data-id", dynamicAttribute()));
const template113 = _$ssrElement("div", [
	first,
	{ class: "x" },
	second
], undefined, true, _sk$8, " id=\"y\"");
const template114 = _$ssrElement("input", spread, undefined, true, _sk$9, " type=\"text\" tabindex=\"0\" style=\" color:red;top:0 \"");
const template115 = _$ssrElement("textarea", [spread, { innerHTML: "<b>x</b>" }], undefined, true);
const template116 = _$ssrElement("li", spread, undefined, true, _sk$6, " class=\"row\" data-kind=\"item\"");
var _v$141 = _$ssrHydrationKey(), _v$142 = () => {
	return _$ssrStyleProperties("color:", _$escape(color(), true), _$escape(key, true) + ":", _$escape(size(), true), "margin-right:", "40px");
};
const template117 = _$ssr(_tmpl$18, _v$141, _v$142);
var _v$143 = _$ssrHydrationKey();
const nullishAttributes = _$ssr(_tmpl$53, _v$143, ((_v$144) => _v$144 == null ? "" : _$ssrAttribute("style", _$ssrStyle(_v$144)))(null), ((_v$145) => _v$145 == null ? "" : _$ssrAttribute("class", _$ssrClassName(_v$145)))(undefined), _$ssrAttribute("title", _$escape(null, true)));
var _v$146 = _$ssrHydrationKey(), _g$4 = _$ssrGroup(() => {
	return [
		((_v$147) => _v$147 == null ? "" : _$ssrAttribute("style", _$ssrStyle(_v$147)))(props.style),
		((_v$149) => _v$149 == null ? "" : _$ssrAttribute("class", _$ssrClassName(_v$149)))(props.class),
		_$ssrAttribute("title", _$escape(props.title, true))
	];
}, 3);
const nullableAttributes = _$ssr(_tmpl$53, _v$146, _g$4, _g$4, _g$4);
var _v$152 = _$ssrHydrationKey();
const emptyAttributes = _$ssr(_tmpl$54, _v$152);
