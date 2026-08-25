import { memo as _$memo } from "r-server";
import { escape as _$escape } from "r-server";
import { ssr as _$ssr } from "r-server";
import { ssrSelectValues as _$ssrSelectValues } from "r-server";
import { ssrAttribute as _$ssrAttribute } from "r-server";
import { ssrClassName as _$ssrClassName } from "r-server";
import { ssrStyle as _$ssrStyle } from "r-server";
import { ssrStyleProperty as _$ssrStyleProperty } from "r-server";
import { ssrGroup as _$ssrGroup } from "r-server";
import { ssrElement as _$ssrElement } from "r-server";
import { mergeProps as _$mergeProps } from "r-server";
var _ref$, _v$, _v$2, _v$22, _v$23, _v$37, _v$38, _v$39, _v$40, _v$41;
var _tmpl$ = ["<a href=\"/\" class=\"", "\">Welcome</a>"];
var _tmpl$2 = ["<div>", "</div>"];
var _tmpl$3 = "<div><div/></div>";
var _tmpl$4 = [
	"<div foo",
	" style=\"",
	"\"",
	">",
	"</div>"
];
var _tmpl$5 = [
	"<div",
	" class=\"",
	"\"></div>"
];
var _tmpl$6 = "<div class=\"a\" className=\"b\"></div>";
var _tmpl$7 = ["<div style=\"", "\">Hi</div>"];
var _tmpl$8 = [
	"<div style=\"",
	"\" class=\"",
	"\"></div>"
];
var _tmpl$9 = "<div></div>";
var _tmpl$10 = "<div onclick=\"console.log('hi')\"></div>";
var _tmpl$11 = "<input type=\"checkbox\" checked>";
var _tmpl$12 = ["<input type=\"checkbox\"", ">"];
var _tmpl$13 = "<div class=\"`a\">`$`</div>";
var _tmpl$14 = ["<button class=\"", "\" type=\"button\">Write</button>"];
var _tmpl$15 = ["<button class=\"", "\">Hi</button>"];
var _tmpl$16 = ["<div class=\"", "\"></div>"];
var _tmpl$17 = [
	"<div><input",
	"",
	"",
	" readonly><input",
	"",
	"",
	"",
	"></div>"
];
var _tmpl$18 = ["<div style=\"", "\"></div>"];
var _tmpl$19 = "<div data=\"&quot;hi&quot;\" data2=\"&quot;\"></div>";
var _tmpl$20 = [
	"<div",
	">",
	"</div>"
];
var _tmpl$21 = [
	"<div>",
	"",
	"</div>"
];
var _tmpl$22 = "<div class=\"class1 class2 class3 class4 class5 class6\" style=\"color:red;background-color:blue !important;border:1px solid black;font-size:12px;\" random=\"random1 random2\n    random3 random4\"></div>";
var _tmpl$23 = ["<button class=\"", "\"></button>"];
var _tmpl$24 = "<input value=\"10\">";
var _tmpl$25 = [
	"<select",
	"><option",
	">Red</option><option",
	">Blue</option></select>"
];
var _tmpl$26 = "<img src>";
var _tmpl$27 = "<div><img src></div>";
var _tmpl$28 = "<img src loading=\"lazy\">";
var _tmpl$29 = "<div><img src loading=\"lazy\"></div>";
var _tmpl$30 = "<iframe src></iframe>";
var _tmpl$31 = "<div><iframe src></iframe></div>";
var _tmpl$32 = "<iframe src loading=\"lazy\"></iframe>";
var _tmpl$33 = "<div><iframe src loading=\"lazy\"></iframe></div>";
var _tmpl$34 = "<div title=\"&lt;u>data&lt;/u>\"></div>";
var _tmpl$35 = "<div true truestr=\"true\" truestrjs=\"true\"></div>";
var _tmpl$36 = "<div falsestr=\"false\" falsestrjs=\"false\"></div>";
var _tmpl$37 = "<div true></div>";
var _tmpl$38 = [
	"<div a b c d f=\"0\" g h",
	"",
	"",
	" l></div>"
];
var _tmpl$39 = "<math display=\"block\"><mrow></mrow></math>";
var _tmpl$40 = "<mrow><mi>x</mi><mo>=</mo></mrow>";
var _tmpl$41 = ["<video", "></video>"];
var _tmpl$42 = "<video playsinline></video>";
var _tmpl$43 = "<video></video>";
var _tmpl$44 = "<video poster=\"1.jpg\"></video>";
var _tmpl$45 = "<div><video poster=\"1.jpg\"></video></div>";
var _tmpl$46 = "<div><video></video></div>";
var _tmpl$47 = [
	"<div style=\"",
	"\"",
	"></div>"
];
var _tmpl$48 = [
	"<button type=\"button\"",
	" style=\"",
	"\" class=\"",
	"\">",
	"</button>"
];
var _tmpl$49 = ["<style>", "</style>"];
var _tmpl$50 = ["<div class=\"bg-(--bg)\" style=\"", "\"></div>"];
var _tmpl$51 = ["<div", "></div>"];
var _tmpl$52 = ["<div class=\"progress-fill\" style=\"", "\"></div>"];
var _tmpl$53 = [
	"<div><textarea>",
	"</textarea><textarea>",
	"</textarea><textarea>",
	"</textarea><textarea></textarea><textarea>",
	"</textarea><textarea>static content</textarea><textarea>static content</textarea></div>"
];
var _tmpl$54 = ["<div><video muted></video><video></video><video></video><video muted></video><video", "></video><video src=\"test.mp4\" muted></video></div>"];
_$ssrSelectValues();
import * as styles from "./styles.module.css";
import { binding } from "somewhere";
function refFn() {}
const refConst = null;
const selected = true;
let id = "my-h1";
let link;
const template = _$ssrElement("div", _$mergeProps({ id: "main" }, results, {
	class: { selected: unknown },
	style: { color }
}), _$ssrElement("h1", _$mergeProps({ id }, results, {
	foo: true,
	disabled: true,
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
}), (_ref$ = link, _$ssr(_tmpl$, "ccc ddd")), false), false);
const template2 = _$ssrElement("div", getProps("test"), [
	(_v$ = _$escape(rowId), _$ssr(_tmpl$2, _v$)),
	(_v$2 = () => {
		return _$escape(row.label);
	}, _$ssr(_tmpl$2, _v$2)),
	_$ssr(_tmpl$3)
], false);
var _g$ = _$ssrGroup(() => {
	return [_$ssrAttribute("name", _$escape(state.name, true)), _$escape(
		/*@static*/
		state.content
	)];
}, 2);
const template3 = _$ssr(_tmpl$4, _$ssrAttribute(
	"id",
	/*@static*/
	_$escape(state.id, true)
), _$ssrStyleProperty("background-color:", _$escape(state.color, true)), _g$, _g$);
var _v$5 = () => {
	return _$ssrAttribute("className", _$escape(state.class, true));
};
const template4 = _$ssr(_tmpl$5, _v$5, "ccc:ddd");
const template5 = _$ssr(_tmpl$6);
var _v$6 = () => {
	return _$ssrStyle(someStyle());
};
const template6 = _$ssr(_tmpl$7, _v$6);
let undefVar;
var _v$7 = () => {
	return _$ssrStyle({
		"background-color": color(),
		"margin-right": "40px",
		...props.style
	});
};
const template7 = _$ssr(_tmpl$8, _v$7, undefVar ? "other-class2" : "");
let refTarget;
var _ref$2 = refTarget;
const template8 = _$ssr(_tmpl$9);
var _ref$3 = (e) => console.log(e);
const template9 = _$ssr(_tmpl$9);
var _ref$4 = refFactory();
const template10 = _$ssr(_tmpl$9);
const template12 = _$ssr(_tmpl$10);
const template13 = _$ssr(_tmpl$11);
var _v$8 = () => {
	return _$ssrAttribute("checked", _$escape(state.visible, true));
};
const template14 = _$ssr(_tmpl$12, _v$8);
const template15 = _$ssr(_tmpl$13);
const template16 = _$ssr(_tmpl$14, _$ssrClassName(["static", { hi: "k" }]));
const template17 = _$ssr(_tmpl$15, "a  b  c");
const template18 = _$ssrElement("div", { get [key()]() {
	return props.value;
} }, undefined, false);
const template19 = _$ssr(_tmpl$16, _$ssrClassName([{ "bg-red-500": true }, "flex flex-col"]));
var _g$3 = _$ssrGroup(() => {
	return [_$ssrAttribute("min", _$escape(min(), true)), _$ssrAttribute("max", _$escape(max(), true))];
}, 2), _g$2 = _$ssrGroup(() => {
	return [_$ssrAttribute("min", _$escape(min(), true)), _$ssrAttribute("max", _$escape(max(), true))];
}, 2), _v$9 = () => {
	return _$ssrAttribute("value", _$escape(s(), true));
}, _v$12 = () => {
	return _$ssrAttribute("checked", _$escape(s2(), true));
};
const template20 = _$ssr(_tmpl$17, _v$9, _g$3, _g$3, _v$12, _g$2, _g$2, _$ssrAttribute("readonly", _$escape(value, true)));
var _v$15 = () => {
	return _$ssrStyle({
		a: "static",
		...rest
	});
};
const template21 = _$ssr(_tmpl$18, _v$15);
const template22 = _$ssr(_tmpl$19);
var _v$16 = () => {
	return _$ssrAttribute("disabled", "t" in _$escape(test, true));
}, _v$17 = () => {
	return "t" in test && "true";
};
const template23 = _$ssr(_tmpl$20, _v$16, _v$17);
const template24 = _$ssrElement("a", _$mergeProps(props, { something: true }), undefined, false);
var _v$18 = () => {
	return _$escape(props.children);
}, _v$19 = _$ssrElement("a", _$mergeProps(props, { something: true }), undefined, false);
const template25 = _$ssr(_tmpl$21, _v$18, _v$19);
const template26 = _$ssrElement("div", _$mergeProps({
	start: "Hi",
	middle
}, spread), "Hi", false);
const template27 = _$ssrElement("div", _$mergeProps({ start: "Hi" }, first, { middle }, second), "Hi", false);
const template28 = _$ssrElement("label", api(), [
	_$ssrElement("span", api(), ["Input is ", () => {
		return api() ? "checked" : "unchecked";
	}], false),
	_$ssrElement("input", api(), undefined, false),
	_$ssrElement("div", api(), undefined, false)
], false);
var _v$20 = !!someValue;
const template29 = _$ssr(_tmpl$20, _$ssrAttribute("attribute", !!someValue), _v$20);
const template30 = _$ssr(_tmpl$22);
var _v$21 = () => {
	return _$ssrStyleProperty("background-color:", _$escape(getStore.itemProperties.color, true));
};
const template31 = _$ssr(_tmpl$18, _v$21);
const template32 = _$ssr(_tmpl$18, _$ssrStyleProperty("background-color:", _$escape(undefined, true)));
const template33 = [
	_$ssr(_tmpl$23, _$ssrClassName(styles.button)),
	_$ssr(_tmpl$23, _$ssrClassName(styles["foo--bar"])),
	(_v$22 = () => {
		return _$ssrClassName(styles.foo.bar);
	}, _$ssr(_tmpl$23, _v$22)),
	(_v$23 = () => {
		return _$ssrClassName(styles[foo()]);
	}, _$ssr(_tmpl$23, _v$23))
];
var _ref$5 = a().b.c;
const template35 = _$ssr(_tmpl$9);
var _ref$6 = a().b?.c;
const template36 = _$ssr(_tmpl$9);
var _ref$7 = a() ? b : c;
const template37 = _$ssr(_tmpl$9);
var _ref$8 = a() ?? b;
const template38 = _$ssr(_tmpl$9);
const template39 = _$ssr(_tmpl$24);
var _v$24 = () => {
	return _$ssrStyleProperty("color:", _$escape(a(), true));
};
const template40 = _$ssr(_tmpl$18, _v$24);
var _v$25 = () => {
	return _$ssrAttribute("value", _$escape(state.color, true));
}, _v$26 = () => {
	return _$ssrAttribute("value", _$escape(Color.Red, true));
}, _v$27 = () => {
	return _$ssrAttribute("value", _$escape(Color.Blue, true));
};
const template41 = _$ssr(_tmpl$25, _v$25, _v$26, _v$27);
const template42 = _$ssr(_tmpl$26);
const template43 = _$ssr(_tmpl$27);
const template44 = _$ssr(_tmpl$28);
const template45 = _$ssr(_tmpl$29);
const template46 = _$ssr(_tmpl$30);
const template47 = _$ssr(_tmpl$31);
const template48 = _$ssr(_tmpl$32);
const template49 = _$ssr(_tmpl$33);
const template50 = _$ssr(_tmpl$34);
var _ref$9 = binding;
const template51 = _$ssr(_tmpl$9);
var _ref$10 = binding.prop;
const template52 = _$ssr(_tmpl$9);
var _ref$11 = refFn;
const template53 = _$ssr(_tmpl$9);
var _ref$12 = refConst;
const template54 = _$ssr(_tmpl$9);
var _ref$13 = refUnknown;
const template55 = _$ssr(_tmpl$9);
const template56 = _$ssr(_tmpl$35);
const template57 = _$ssr(_tmpl$36);
const template58 = _$ssr(_tmpl$9);
const template59 = _$ssr(_tmpl$37);
const template60 = _$ssr(_tmpl$38, _$ssrAttribute("i", _$escape(undefined, true)), _$ssrAttribute("j", _$escape(null, true)), _$ssrAttribute("k", void 0));
const template61 = _$ssr(_tmpl$39);
const template62 = _$ssr(_tmpl$40);
const template63 = _$ssr(_tmpl$18, _$ssrStyleProperty("background:", "red"));
const template64 = _$ssr(_tmpl$18, _$ssrStyleProperty("background:", "red") + _$ssrStyleProperty(";color:", "green") + _$ssrStyleProperty(";margin:", 3) + _$ssrStyleProperty(";padding:", .4));
const template65 = _$ssr(_tmpl$18, _$ssrStyleProperty("background:", "red") + _$ssrStyleProperty(";color:", "green") + _$ssrStyleProperty(";border:", _$escape(undefined, true)));
var _v$28 = () => {
	return _$ssrStyleProperty("background:", "red") + _$ssrStyleProperty(";color:", "green") + _$ssrStyleProperty(";border:", _$escape(signal(), true));
};
const template66 = _$ssr(_tmpl$18, _v$28);
const template67 = _$ssr(_tmpl$18, _$ssrStyleProperty("background:", "red") + _$ssrStyleProperty(";color:", "green") + _$ssrStyleProperty(";border:", _$escape(somevalue, true)));
var _v$29 = () => {
	return _$ssrStyleProperty("background:", "red") + _$ssrStyleProperty(";color:", "green") + _$ssrStyleProperty(";border:", _$escape(some.access, true));
};
const template68 = _$ssr(_tmpl$18, _v$29);
const template69 = _$ssr(_tmpl$18, _$ssrStyleProperty("background:", "red") + _$ssrStyleProperty(";color:", "green") + _$ssrStyleProperty(";border:", _$escape(null, true)));
const template70 = _$ssr(_tmpl$41, _$ssrAttribute("playsinline", _$escape(value, true)));
const template71 = _$ssr(_tmpl$42);
const template72 = _$ssr(_tmpl$43);
const template73 = _$ssr(_tmpl$44);
const template74 = _$ssr(_tmpl$45);
const template75 = _$ssr(_tmpl$43);
const template76 = _$ssr(_tmpl$46);
// STATIC TESTS
const template77 = _$ssr(_tmpl$18, _$ssrStyleProperty("width:", _$escape(props.width, true)) + _$ssrStyleProperty(";height:", _$escape(props.height, true)));
var _v$30 = () => {
	return _$ssrAttribute("something", _$escape(color(), true));
};
const template78 = _$ssr(_tmpl$47, _$ssrStyleProperty("width:", _$escape(props.width, true)) + _$ssrStyleProperty(";height:", _$escape(props.height, true)), _v$30);
var _v$31 = () => {
	return _$ssrStyleProperty("width:", _$escape(props.width, true)) + _$ssrStyleProperty(
		";height:",
		/* @static */
		_$escape(props.height, true)
	);
};
const template79 = _$ssr(_tmpl$47, _v$31, _$ssrAttribute(
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
const template80 = _$ssrElement("div", propsSpread, undefined, false);
const template81 = _$ssrElement("div", propsSpread, undefined, false);
const template82 = _$ssrElement("div", _$mergeProps(propsSpread, {
	get ["data-dynamic"]() {
		return color();
	},
	"data-static": /* @static */ color()
}), undefined, false);
const template83 = _$ssrElement("div", _$mergeProps(propsSpread, {
	get ["data-dynamic"]() {
		return color();
	},
	"data-static": /* @static */ color()
}), undefined, false);
const template84 = _$ssrElement("div", _$mergeProps(propsSpread1, propsSpread2, propsSpread3, {
	get ["data-dynamic"]() {
		return color();
	},
	"data-static": /* @static */ color()
}), undefined, false);
// STATIC PROPERTY OF OBJECT ACCESS
// https://github.com/ryansolid/dom-expressions/issues/252#issuecomment-1572220563
const styleProp = { style: {
	width: props.width,
	height: props.height
} };
const template85 = _$ssr(_tmpl$18, _$ssrStyle(
	/* @static */
	styleProp.style
));
var _v$32 = () => {
	return _$ssrStyle(styleProp.style);
};
const template86 = _$ssr(_tmpl$18, _v$32);
const style = {
	background: "red",
	border: "solid black " + count() + "px"
};
var _v$33 = () => {
	return _$ssrAttribute("aria-label", _$escape(count(), true));
}, _v$34 = () => {
	return _$escape(count());
};
const template87 = _$ssr(_tmpl$48, _v$33, _$ssrStyle(style), _$ssrClassName(style), _v$34);
var _v$35 = () => {
	return _$ssrAttribute("aria-label", _$escape(count(), true));
}, _v$36 = () => {
	return _$escape(count());
};
const template88 = _$ssr(_tmpl$48, _v$35, _$ssrStyle(
	/* @static*/
	style
), _$ssrClassName(
	/* @static*/
	style
), _v$36);
const css = () => "&{color:red}";
const template89 = [
	(_v$37 = () => {
		return css();
	}, _$ssr(_tmpl$49, _v$37)),
	(_v$38 = () => {
		return css();
	}, _$ssr(_tmpl$49, _v$38)),
	(_v$39 = () => {
		return css();
	}, _$ssr(_tmpl$49, _v$39)),
	(_v$40 = () => {
		return css();
	}, _$ssr(_tmpl$49, _v$40)),
	(_v$41 = () => {
		return css();
	}, _$ssr(_tmpl$49, _v$41))
];
const styleProps = { children: css };
const template90 = [
	_$ssrElement("style", styleProps(), () => {
		return css();
	}, false),
	_$ssrElement("style", _$mergeProps(styleProps, { get children() {
		return css();
	} }), undefined, false),
	_$ssrElement("style", _$mergeProps(styleProps, { get innerHTML() {
		return css();
	} }), undefined, false),
	_$ssrElement("style", _$mergeProps(styleProps, { get innerText() {
		return css();
	} }), undefined, false),
	_$ssrElement("style", _$mergeProps(styleProps, { get textContent() {
		return css();
	} }), undefined, false)
];
const nope = () => undefined;
var _v$42 = () => {
	return _$ssrStyleProperty("--bg:", _$escape(nope(), true));
};
const template91 = _$ssr(_tmpl$50, _v$42);
const template92 = _$ssr(_tmpl$9);
var _v$43 = () => {
	return _$ssrAttribute("data-test", _$escape(state.flag || undefined, true));
};
const template93 = _$ssr(_tmpl$51, _v$43);
function Progress(props) {
	var _v$44 = () => {
		return _$ssrStyleProperty(_$escape(props.orientation === "y" ? "height" : "width", true) + ":", `${_$escape(props.value, true) * 100}%`);
	};
	return _$ssr(_tmpl$52, _v$44);
}
var _v$45 = () => {
	return _$escape(dynamicProperty());
}, _v$46 = () => {
	return _$escape(dynamicProperty());
}, _v$47 = () => {
	return _$escape(dynamicContent());
}, _v$48 = () => {
	return _$escape(dynamicContent());
};
const template94 = _$ssr(_tmpl$53, _v$45, _v$46, _v$47, _v$48);
var _v$49 = () => {
	return _$ssrAttribute("muted", _$escape(dynamicAttribute(), true));
};
const template95 = _$ssr(_tmpl$54, _v$49);
