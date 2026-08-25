import { createTextNode as _$createTextNode2 } from "r-custom";
import { insertNode as _$insertNode2 } from "r-custom";
import { createElement as _$createElement2 } from "r-custom";
import { template as _$template } from "r-dom";
import { insert as _$insert } from "r-dom";
import { memo as _$memo } from "r-custom";
import { spread as _$spread } from "r-dom";
import { mergeProps as _$mergeProps } from "r-custom";
import { ref as _$ref } from "r-dom";
import { style as _$style } from "r-dom";
import { setStyleProperty as _$setStyleProperty } from "r-dom";
import { className as _$className } from "r-dom";
import { effect as _$effect } from "r-custom";
import { setAttribute as _$setAttribute } from "r-dom";
import { claimElement as _$claimElement } from "r-dom";
import { addEvent as _$addEvent } from "r-dom";
import { delegateEvents as _$delegateEvents } from "r-dom";
var _tmpl$ = /* @__PURE__ */ _$template(`<div><h1><a href=/>Welcome`);
var _tmpl$2 = /* @__PURE__ */ _$template(`<div><div></div><div> </div><div>`);
var _tmpl$3 = /* @__PURE__ */ _$template(`<div foo>`);
var _tmpl$4 = /* @__PURE__ */ _$template(`<div>`);
var _tmpl$5 = /* @__PURE__ */ _$template(`<div class=a className=b>`);
var _tmpl$6 = /* @__PURE__ */ _$template(`<div style=margin-right:40px>`);
var _tmpl$7 = /* @__PURE__ */ _$template(`<div onclick="console.log('hi')">`);
var _tmpl$8 = /* @__PURE__ */ _$template(`<input type=checkbox checked>`);
var _tmpl$9 = /* @__PURE__ */ _$template(`<input type=checkbox>`);
var _tmpl$10 = /* @__PURE__ */ _$template(`<div class="\`a">\`$\``);
var _tmpl$11 = /* @__PURE__ */ _$template(`<button class="static hi"type=button>Write`);
var _tmpl$12 = /* @__PURE__ */ _$template(`<button class="a b c">Hi`);
var _tmpl$13 = /* @__PURE__ */ _$template(`<div><input readonly><input>`);
var _tmpl$14 = /* @__PURE__ */ _$template(`<div style=a:static>`);
var _tmpl$15 = /* @__PURE__ */ _$template(`<div data="&quot;hi&quot;"data2="&quot;">`);
var _tmpl$16 = /* @__PURE__ */ _$template(`<a>`);
var _tmpl$17 = /* @__PURE__ */ _$template(`<div><a>`);
var _tmpl$18 = /* @__PURE__ */ _$template(`<div>Hi`);
var _tmpl$19 = /* @__PURE__ */ _$template(`<label><span>Input is </span><input><div>`);
var _tmpl$20 = /* @__PURE__ */ _$template(`<div class="class1 class2 class3 class4 class5 class6"random="random1 random2
    random3 random4"style="color:red;background-color:blue !important;border:1px solid black;font-size:12px">`);
var _tmpl$21 = /* @__PURE__ */ _$template(`<button>`);
var _tmpl$22 = /* @__PURE__ */ _$template(`<input value=10>`);
var _tmpl$23 = /* @__PURE__ */ _$template(`<select><option>Red</option><option>Blue`);
var _tmpl$24 = /* @__PURE__ */ _$template(`<img src>`);
var _tmpl$25 = /* @__PURE__ */ _$template(`<div><img src>`);
var _tmpl$26 = /* @__PURE__ */ _$template(`<img src loading=lazy>`, 1);
var _tmpl$27 = /* @__PURE__ */ _$template(`<div><img src loading=lazy>`, 1);
var _tmpl$28 = /* @__PURE__ */ _$template(`<iframe src>`);
var _tmpl$29 = /* @__PURE__ */ _$template(`<div><iframe src>`);
var _tmpl$30 = /* @__PURE__ */ _$template(`<iframe src loading=lazy>`, 1);
var _tmpl$31 = /* @__PURE__ */ _$template(`<div><iframe src loading=lazy>`, 1);
var _tmpl$32 = /* @__PURE__ */ _$template(`<div title="&lt;u>data&lt;/u>">`);
var _tmpl$33 = /* @__PURE__ */ _$template(`<div true truestr=true truestrjs=true>`);
var _tmpl$34 = /* @__PURE__ */ _$template(`<div falsestr=false falsestrjs=false>`);
var _tmpl$35 = /* @__PURE__ */ _$template(`<div true>`);
var _tmpl$36 = /* @__PURE__ */ _$template(`<div a b c d f=0 g h l>`);
var _tmpl$37 = /* @__PURE__ */ _$template(`<div style=background:red>`);
var _tmpl$38 = /* @__PURE__ */ _$template(`<div style=background:red;color:green;margin:3;padding:0.4>`);
var _tmpl$39 = /* @__PURE__ */ _$template(`<div style=background:red;color:green>`);
var _tmpl$40 = /* @__PURE__ */ _$template(`<video>`);
var _tmpl$41 = /* @__PURE__ */ _$template(`<video playsinline>`);
var _tmpl$42 = /* @__PURE__ */ _$template(`<video poster=1.jpg>`);
var _tmpl$43 = /* @__PURE__ */ _$template(`<div><video poster=1.jpg>`);
var _tmpl$44 = /* @__PURE__ */ _$template(`<div><video>`);
var _tmpl$45 = /* @__PURE__ */ _$template(`<button type=button>`);
import * as styles from "./styles.module.css";
import { binding } from "somewhere";
function refFn() {}
const refConst = null;
const selected = true;
let id = "my-h1";
let link;
var _el$ = _tmpl$();
var _el$2 = _el$.firstChild;
var _el$3 = _el$2.firstChild;
_$spread(_el$, _$mergeProps({ id: "main" }, results, {
	class: { selected: unknown },
	style: { color }
}), true);
_$spread(_el$2, _$mergeProps({ id }, results, {
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
}), true);
var _ref$ = link;
typeof _ref$ === "function" || Array.isArray(_ref$) ? _$ref(() => {
	return _ref$;
}, _el$3) : link = _el$3;
_$claimElement(_el$3);
_$className(_el$3, { "ccc ddd": true });
const template = _el$;
var _el$4 = _tmpl$2();
var _el$5 = _el$4.firstChild;
var _el$6 = _el$5.nextSibling;
var _el$7 = _el$6.firstChild;
var _el$8 = _el$6.nextSibling;
_$spread(_el$4, _$mergeProps(() => {
	return getProps("test");
}), true);
_el$5.textContent = rowId;
_el$8.innerHTML = "<div/>";
_$effect(() => row.label, (_v$) => {
	_el$7.data = _v$;
});
const template2 = _el$4;
var _el$9 = _tmpl$3();
_$setAttribute(
	_el$9,
	"id",
	/*@static*/
	state.id
);
_$setStyleProperty(_el$9, "background-color", state.color);
_el$9.textContent = state.content;
_$effect(() => state.name, (_v$) => {
	_$setAttribute(_el$9, "name", _v$);
});
const template3 = _el$9;
var _el$10 = _tmpl$4();
_$className(_el$10, { "ccc:ddd": true });
_$effect(() => state.class, (_v$) => {
	_$setAttribute(_el$10, "className", _v$);
});
const template4 = _el$10;
const template5 = _tmpl$5();
var _el$12 = _tmpl$4();
_el$12.textContent = "Hi";
_$effect(() => someStyle(), (_v$, _$p) => {
	_$style(_el$12, _v$, _$p);
});
const template6 = _el$12;
let undefVar;
var _el$13 = _tmpl$6();
_el$13.classList.toggle("other-class2", !!undefVar);
_$effect(() => ({
	"background-color": color(),
	...props.style
}), (_v$, _$p) => {
	_$style(_el$13, _v$, _$p);
});
const template7 = _el$13;
let refTarget;
var _el$14 = _tmpl$4();
var _ref$2 = refTarget;
typeof _ref$2 === "function" || Array.isArray(_ref$2) ? _$ref(() => {
	return _ref$2;
}, _el$14) : refTarget = _el$14;
const template8 = _el$14;
var _el$15 = _tmpl$4();
_$ref(() => {
	return (e) => console.log(e);
}, _el$15);
const template9 = _el$15;
var _el$16 = _tmpl$4();
var _ref$3 = refFactory();
(typeof _ref$3 === "function" || Array.isArray(_ref$3)) && _$ref(() => {
	return _ref$3;
}, _el$16);
const template10 = _el$16;
var _el$17 = _tmpl$7();
_el$17.htmlFor = thing;
_el$17.number = 123;
const template12 = _el$17;
const template13 = _tmpl$8();
var _el$19 = _tmpl$9();
_$effect(() => state.visible, (_v$) => {
	_el$19.checked = _v$;
});
const template14 = _el$19;
const template15 = _tmpl$10();
const template16 = _tmpl$11();
var _el$22 = _tmpl$12();
_$addEvent(_el$22, "click", increment, true);
const template17 = _el$22;
var _el$23 = _tmpl$4();
_$spread(_el$23, _$mergeProps(() => {
	return { get [key()]() {
		return props.value;
	} };
}), false);
const template18 = _el$23;
var _el$24 = _tmpl$4();
_$className(_el$24, [{ "bg-red-500": true }, "flex flex-col"]);
const template19 = _el$24;
var _el$25 = _tmpl$13();
var _el$26 = _el$25.firstChild;
var _el$27 = _el$26.nextSibling;
_$addEvent(_el$26, "input", doSomething, true);
_$addEvent(_el$27, "input", doSomethingElse, true);
_$setAttribute(_el$27, "readonly", value);
_$effect(() => {
	return {
		e: s(),
		t: min(),
		a: max(),
		o: s2(),
		i: min(),
		n: max()
	};
}, ({ e, t, a, o, i, n }, _p$) => {
	_el$26.value = e ?? "";
	t !== _p$?.t && _$setAttribute(_el$26, "min", t);
	a !== _p$?.a && _$setAttribute(_el$26, "max", a);
	_el$27.checked = o;
	i !== _p$?.i && _$setAttribute(_el$27, "min", i);
	n !== _p$?.n && _$setAttribute(_el$27, "max", n);
});
const template20 = _el$25;
var _el$28 = _tmpl$14();
_$effect(() => ({ ...rest }), (_v$, _$p) => {
	_$style(_el$28, _v$, _$p);
});
const template21 = _el$28;
const template22 = _tmpl$15();
var _el$30 = _tmpl$4();
_$insert(_el$30, () => {
	return "t" in test && "true";
});
_$effect(() => "t" in test, (_v$) => {
	_$setAttribute(_el$30, "disabled", _v$);
});
const template23 = _el$30;
var _el$31 = _tmpl$16();
_$claimElement(_el$31);
_$spread(_el$31, _$mergeProps(props, { something: true }), false);
const template24 = _el$31;
var _el$32 = _tmpl$17();
var _el$33 = _el$32.firstChild;
_$insert(_el$32, () => {
	return props.children;
}, _el$32.firstChild);
_$claimElement(_el$33);
_$spread(_el$33, _$mergeProps(props, { something: true }), false);
const template25 = _el$32;
var _el$34 = _tmpl$18();
_$spread(_el$34, _$mergeProps({
	start: "Hi",
	middle
}, spread), true);
const template26 = _el$34;
var _el$35 = _tmpl$18();
_$spread(_el$35, _$mergeProps({ start: "Hi" }, first, { middle }, second), true);
const template27 = _el$35;
var _el$36 = _tmpl$19();
var _el$37 = _el$36.firstChild;
var _el$38 = _el$37.firstChild;
var _el$39 = _el$37.nextSibling;
var _el$40 = _el$39.nextSibling;
_$spread(_el$36, _$mergeProps(api), true);
_$spread(_el$37, _$mergeProps(api), true);
_$insert(_el$37, () => {
	return api() ? "checked" : "unchecked";
}, null);
_$spread(_el$39, _$mergeProps(api), false);
_$spread(_el$40, _$mergeProps(api), false);
const template28 = _el$36;
var _el$41 = _tmpl$4();
_$setAttribute(_el$41, "attribute", !!someValue);
_$insert(_el$41, !!someValue);
const template29 = _el$41;
const template30 = _tmpl$20();
var _el$43 = _tmpl$4();
_$effect(() => getStore.itemProperties.color, (_v$) => {
	_$setStyleProperty(_el$43, "background-color", _v$);
});
const template31 = _el$43;
const template32 = _tmpl$4();
const template33 = [
	(() => {
		var _el$45 = _tmpl$21();
		_$effect(() => styles.button, (_v$, _$p) => {
			_$className(_el$45, _v$, _$p);
		});
		return _el$45;
	})(),
	(() => {
		var _el$46 = _tmpl$21();
		_$effect(() => styles["foo--bar"], (_v$, _$p) => {
			_$className(_el$46, _v$, _$p);
		});
		return _el$46;
	})(),
	(() => {
		var _el$47 = _tmpl$21();
		_$effect(() => styles.foo.bar, (_v$, _$p) => {
			_$className(_el$47, _v$, _$p);
		});
		return _el$47;
	})(),
	(() => {
		var _el$48 = _tmpl$21();
		_$effect(() => styles[foo()], (_v$, _$p) => {
			_$className(_el$48, _v$, _$p);
		});
		return _el$48;
	})()
];
var _el$49 = _tmpl$4();
var _ref$4 = a().b.c;
typeof _ref$4 === "function" || Array.isArray(_ref$4) ? _$ref(() => {
	return _ref$4;
}, _el$49) : a().b.c = _el$49;
const template35 = _el$49;
var _el$50 = _tmpl$4();
var _ref$5 = a().b?.c;
(typeof _ref$5 === "function" || Array.isArray(_ref$5)) && _$ref(() => {
	return _ref$5;
}, _el$50);
const template36 = _el$50;
var _el$51 = _tmpl$4();
var _ref$6 = a() ? b : c;
(typeof _ref$6 === "function" || Array.isArray(_ref$6)) && _$ref(() => {
	return _ref$6;
}, _el$51);
const template37 = _el$51;
var _el$52 = _tmpl$4();
var _ref$7 = a() ?? b;
(typeof _ref$7 === "function" || Array.isArray(_ref$7)) && _$ref(() => {
	return _ref$7;
}, _el$52);
const template38 = _el$52;
const template39 = _tmpl$22();
var _el$54 = _tmpl$4();
_$effect(() => a(), (_v$) => {
	_$setStyleProperty(_el$54, "color", _v$);
});
const template40 = _el$54;
var _el$55 = _tmpl$23();
var _el$56 = _el$55.firstChild;
var _el$57 = _el$56.nextSibling;
_$effect(() => {
	return {
		e: state.color,
		t: Color.Red,
		a: Color.Blue
	};
}, ({ e, t, a }, _p$) => {
	queueMicrotask(() => {
		return _el$55.value = e;
	}) || (_el$55.value = e);
	_el$56.value = t;
	_el$57.value = a;
});
const template41 = _el$55;
const template42 = _tmpl$24();
const template43 = _tmpl$25();
const template44 = _tmpl$26();
const template45 = _tmpl$27();
const template46 = _tmpl$28();
const template47 = _tmpl$29();
const template48 = _tmpl$30();
const template49 = _tmpl$31();
const template50 = _tmpl$32();
var _el$67 = _tmpl$4();
_$ref(() => {
	return binding;
}, _el$67);
const template51 = _el$67;
var _el$68 = _tmpl$4();
var _ref$8 = binding.prop;
typeof _ref$8 === "function" || Array.isArray(_ref$8) ? _$ref(() => {
	return _ref$8;
}, _el$68) : binding.prop = _el$68;
const template52 = _el$68;
var _el$69 = _tmpl$4();
var _ref$9 = refFn;
typeof _ref$9 === "function" || Array.isArray(_ref$9) ? _$ref(() => {
	return _ref$9;
}, _el$69) : refFn = _el$69;
const template53 = _el$69;
var _el$70 = _tmpl$4();
_$ref(() => {
	return refConst;
}, _el$70);
const template54 = _el$70;
var _el$71 = _tmpl$4();
var _ref$10 = refUnknown;
typeof _ref$10 === "function" || Array.isArray(_ref$10) ? _$ref(() => {
	return _ref$10;
}, _el$71) : refUnknown = _el$71;
const template55 = _el$71;
const template56 = _tmpl$33();
const template57 = _tmpl$34();
var _el$74 = _tmpl$4();
_el$74.true = true;
_el$74.false = false;
const template58 = _el$74;
const template59 = _tmpl$35();
var _el$76 = _tmpl$36();
_$setAttribute(_el$76, "i", undefined);
_$setAttribute(_el$76, "j", null);
_$setAttribute(_el$76, "k", void 0);
const template60 = _el$76;
var _el$77 = _$createElement2("math", { display: "block" });
var _el$78 = _$createElement2("mrow");
_$insertNode2(_el$77, _el$78);
const template61 = _el$77;
var _el$79 = _$createElement2("mrow");
var _el$80 = _$createElement2("mi");
var _el$81 = _$createElement2("mo");
_$insertNode2(_el$79, _el$80);
_$insertNode2(_el$79, _el$81);
_$insertNode2(_el$80, _$createTextNode2("x"));
_$insertNode2(_el$81, _$createTextNode2("="));
const template62 = _el$79;
const template63 = _tmpl$37();
const template64 = _tmpl$38();
const template65 = _tmpl$39();
var _el$85 = _tmpl$39();
_$effect(() => signal(), (_v$) => {
	_$setStyleProperty(_el$85, "border", _v$);
});
const template66 = _el$85;
var _el$86 = _tmpl$39();
_$setStyleProperty(_el$86, "border", somevalue);
const template67 = _el$86;
var _el$87 = _tmpl$39();
_$effect(() => some.access, (_v$) => {
	_$setStyleProperty(_el$87, "border", _v$);
});
const template68 = _el$87;
const template69 = _tmpl$39();
var _el$89 = _tmpl$40();
_$setAttribute(_el$89, "playsinline", value);
const template70 = _el$89;
const template71 = _tmpl$41();
const template72 = _tmpl$40();
const template73 = _tmpl$42();
const template74 = _tmpl$43();
var _el$94 = _tmpl$40();
_el$94.poster = "1.jpg";
const template75 = _el$94;
var _el$95 = _tmpl$44();
var _el$96 = _el$95.firstChild;
_el$96.poster = "1.jpg";
const template76 = _el$95;
var _el$97 = _tmpl$4();
_$setStyleProperty(_el$97, "width", props.width);
_$setStyleProperty(_el$97, "height", props.height);
// STATIC TESTS
const template77 = _el$97;
var _el$98 = _tmpl$4();
_$setStyleProperty(_el$98, "width", props.width);
_$setStyleProperty(_el$98, "height", props.height);
_$effect(() => color(), (_v$) => {
	_$setAttribute(_el$98, "something", _v$);
});
const template78 = _el$98;
var _el$99 = _tmpl$4();
_$setStyleProperty(
	_el$99,
	"height",
	/* @static */
	props.height
);
_$setAttribute(
	_el$99,
	"something",
	/*@static*/
	color()
);
_$effect(() => props.width, (_v$) => {
	_$setStyleProperty(_el$99, "width", _v$);
});
const template79 = _el$99;
// STATIC TESTS SPREADS
const propsSpread = {
	something: color(),
	style: {
		"background-color": color(),
		color: /* @static*/ color(),
		"margin-right": /* @static */ props.right
	}
};
var _el$100 = _tmpl$4();
_$spread(_el$100, propsSpread, false);
const template80 = _el$100;
var _el$101 = _tmpl$4();
_$spread(_el$101, { ...propsSpread }, false);
const template81 = _el$101;
var _el$102 = _tmpl$4();
_$spread(_el$102, _$mergeProps(propsSpread, {
	get ["data-dynamic"]() {
		return color();
	},
	"data-static": /* @static */ color()
}), false);
const template82 = _el$102;
var _el$103 = _tmpl$4();
_$spread(_el$103, _$mergeProps({ ...propsSpread }, {
	get ["data-dynamic"]() {
		return color();
	},
	"data-static": /* @static */ color()
}), false);
const template83 = _el$103;
var _el$104 = _tmpl$4();
_$spread(_el$104, _$mergeProps({ ...propsSpread1 }, propsSpread2, { ...propsSpread3 }, {
	get ["data-dynamic"]() {
		return color();
	},
	"data-static": /* @static */ color()
}), false);
const template84 = _el$104;
// STATIC PROPERTY OF OBJECT ACCESS
// https://github.com/ryansolid/dom-expressions/issues/252#issuecomment-1572220563
const styleProp = { style: {
	width: props.width,
	height: props.height
} };
var _el$105 = _tmpl$4();
_$style(
	_el$105,
	/* @static */
	styleProp.style
);
const template85 = _el$105;
var _el$106 = _tmpl$4();
_$effect(() => styleProp.style, (_v$, _$p) => {
	_$style(_el$106, _v$, _$p);
});
const template86 = _el$106;
const style = {
	background: "red",
	border: "solid black " + count() + "px"
};
var _el$107 = _tmpl$45();
_$insert(_el$107, count);
_$effect(() => {
	return {
		e: count(),
		t: style,
		a: style
	};
}, ({ e, t, a }, _p$) => {
	e !== _p$?.e && _$setAttribute(_el$107, "aria-label", e);
	_$style(_el$107, t, _p$?.t);
	_$className(_el$107, a, _p$?.a);
});
const template87 = _el$107;
var _el$108 = _tmpl$45();
_$style(
	_el$108,
	/* @static*/
	style
);
_$className(
	_el$108,
	/* @static*/
	style
);
_$insert(_el$108, count);
_$effect(() => count(), (_v$) => {
	_$setAttribute(_el$108, "aria-label", _v$);
});
const template88 = _el$108;
_$delegateEvents(["click", "input"]);
