import { template as _$template } from "r-dom";
import { getNextElement as _$getNextElement } from "r-dom";
import { getNextMarker as _$getNextMarker } from "r-dom";
import { insert as _$insert } from "r-dom";
import { scope as _$scope } from "r-dom";
import { memo as _$memo } from "r-dom";
import { createComponent as _$createComponent } from "r-dom";
import { mergeProps as _$mergeProps } from "r-dom";
import { applyRef as _$applyRef } from "r-dom";
import { ref as _$ref } from "r-dom";
import { For as _$For } from "r-dom";
var _tmpl$ = /* @__PURE__ */ _$template(`<div>Hello <!$><!/>`);
var _tmpl$2 = /* @__PURE__ */ _$template(`<div>`);
var _tmpl$3 = /* @__PURE__ */ _$template(`<div>From Parent`);
var _tmpl$4 = /* @__PURE__ */ _$template(`<div><!$><!/><!$><!/><!$><!/>`);
var _tmpl$5 = /* @__PURE__ */ _$template(`<div><!$><!/> | <!$><!/> | <!$><!/> | <!$><!/> | <!$><!/> | <!$><!/>`);
var _tmpl$6 = /* @__PURE__ */ _$template(`<div><!$><!/> | <!$><!/><!$><!/> | <!$><!/><!$><!/> | <!$><!/>`);
var _tmpl$7 = /* @__PURE__ */ _$template(`<div> | <!$><!/> |  |  | <!$><!/> | `);
var _tmpl$8 = /* @__PURE__ */ _$template(`<span>1`);
var _tmpl$9 = /* @__PURE__ */ _$template(`<span>2`);
var _tmpl$10 = /* @__PURE__ */ _$template(`<span>3`);
import { Show } from "somewhere";
const Child = (props) => {
	const [s, set] = createSignal();
	return [(() => {
		var _el$ = _$getNextElement(_tmpl$);
		var _el$2 = _el$.firstChild;
		var _el$3 = _el$2.nextSibling;
		var [_el$4, _el$5] = _$getNextMarker(_el$3.nextSibling);
		var _ref$ = props.ref;
		typeof _ref$ === "function" || Array.isArray(_ref$) ? _$ref(() => {
			return _ref$;
		}, _el$) : props.ref = _el$;
		_$insert(_el$, () => {
			return props.name;
		}, _el$4, _el$5);
		return _el$;
	})(), (() => {
		var _el$6 = _$getNextElement(_tmpl$2);
		_$ref(() => {
			return set;
		}, _el$6);
		_$insert(_el$6, _$scope(() => {
			return props.children;
		}));
		return _el$6;
	})()];
};
const template = (props) => {
	let childRef;
	const { content } = props;
	var _el$7 = _$getNextElement(_tmpl$4);
	var _el$9 = _el$7.firstChild;
	var [_el$10, _el$11] = _$getNextMarker(_el$9.nextSibling);
	var _el$13 = _el$10.nextSibling;
	var [_el$14, _el$15] = _$getNextMarker(_el$13.nextSibling);
	var _el$16 = _el$14.nextSibling;
	var [_el$17, _el$18] = _$getNextMarker(_el$16.nextSibling);
	_$insert(_el$7, _$createComponent(Child, _$mergeProps({ name: "John" }, props, {
		ref(r$) {
			var _ref$2 = childRef;
			typeof _ref$2 === "function" || Array.isArray(_ref$2) ? _$applyRef(_ref$2, r$) : childRef = r$;
		},
		booleanProperty: true,
		get children() {
			return _$getNextElement(_tmpl$3);
		}
	})), _el$10, _el$11);
	_$insert(_el$7, _$createComponent(Child, _$mergeProps({ name: "Jason" }, dynamicSpread, {
		ref(r$) {
			var _ref$3 = props.ref;
			typeof _ref$3 === "function" || Array.isArray(_ref$3) ? _$applyRef(_ref$3, r$) : props.ref = r$;
		},
		get children() {
			var _el$12 = _$getNextElement(_tmpl$2);
			_$insert(_el$12, content);
			return _el$12;
		}
	})), _el$14, _el$15);
	_$insert(_el$7, (() => {
		var _ref$4 = props.consumerRef();
		return _$createComponent(Context.Consumer, {
			ref(r$) {
				(typeof _ref$4 === "function" || Array.isArray(_ref$4)) && _$applyRef(_ref$4, r$);
			},
			children: (context) => context
		});
	})(), _el$17, _el$18);
	return _el$7;
};
const template2 = _$createComponent(Child, {
	name: "Jake",
	get dynamic() {
		return state.data;
	},
	stale: /*@static*/ state.data,
	handleClick: clickHandler,
	get ["hyphen-ated"]() {
		return state.data;
	},
	ref: (el) => e = el
});
const template3 = _$createComponent(Child, { get children() {
	return [
		_$getNextElement(_tmpl$2),
		_$getNextElement(_tmpl$2),
		_$getNextElement(_tmpl$2),
		"After"
	];
} });
const [s, set] = createSignal();
const template4 = _$createComponent(Child, {
	ref: set,
	get children() {
		return _$getNextElement(_tmpl$2);
	}
});
const template5 = _$createComponent(Child, {
	get dynamic() {
		return state.dynamic;
	},
	get children() {
		return state.dynamic;
	}
});
// builtIns
const template6 = _$createComponent(_$For, {
	get each() {
		return state.list;
	},
	get fallback() {
		return _$createComponent(Loading, {});
	},
	children: (item) => _$createComponent(Show, {
		get when() {
			return state.condition;
		},
		children: item
	})
});
const template7 = _$createComponent(Child, { get children() {
	return [_$getNextElement(_tmpl$2), _$memo(() => {
		return state.dynamic;
	})];
} });
const template8 = _$createComponent(Child, { get children() {
	return [(item) => item, (item) => item];
} });
const template9 = _$createComponent(_garbage, { children: "Hi" });
var _el$24 = _$getNextElement(_tmpl$5);
var _el$25 = _el$24.firstChild;
var [_el$26, _el$27] = _$getNextMarker(_el$25.nextSibling);
var _el$28 = _el$26.nextSibling;
var _el$29 = _el$28.nextSibling;
var [_el$30, _el$31] = _$getNextMarker(_el$29.nextSibling);
var _el$32 = _el$30.nextSibling;
var _el$33 = _el$32.nextSibling;
var [_el$34, _el$35] = _$getNextMarker(_el$33.nextSibling);
var _el$36 = _el$34.nextSibling;
var _el$37 = _el$36.nextSibling;
var [_el$38, _el$39] = _$getNextMarker(_el$37.nextSibling);
var _el$40 = _el$38.nextSibling;
var _el$41 = _el$40.nextSibling;
var [_el$42, _el$43] = _$getNextMarker(_el$41.nextSibling);
var _el$44 = _el$42.nextSibling;
var _el$45 = _el$44.nextSibling;
var [_el$46, _el$47] = _$getNextMarker(_el$45.nextSibling);
_$insert(_el$24, _$createComponent(Link, { children: "new" }), _el$26, _el$27);
_$insert(_el$24, _$createComponent(Link, { children: "comments" }), _el$30, _el$31);
_$insert(_el$24, _$createComponent(Link, { children: "show" }), _el$34, _el$35);
_$insert(_el$24, _$createComponent(Link, { children: "ask" }), _el$38, _el$39);
_$insert(_el$24, _$createComponent(Link, { children: "jobs" }), _el$42, _el$43);
_$insert(_el$24, _$createComponent(Link, { children: "submit" }), _el$46, _el$47);
const template10 = _el$24;
var _el$48 = _$getNextElement(_tmpl$6);
var _el$49 = _el$48.firstChild;
var [_el$50, _el$51] = _$getNextMarker(_el$49.nextSibling);
var _el$52 = _el$50.nextSibling;
var _el$53 = _el$52.nextSibling;
var [_el$54, _el$55] = _$getNextMarker(_el$53.nextSibling);
var _el$56 = _el$54.nextSibling;
var [_el$57, _el$58] = _$getNextMarker(_el$56.nextSibling);
var _el$59 = _el$57.nextSibling;
var _el$60 = _el$59.nextSibling;
var [_el$61, _el$62] = _$getNextMarker(_el$60.nextSibling);
var _el$63 = _el$61.nextSibling;
var [_el$64, _el$65] = _$getNextMarker(_el$63.nextSibling);
var _el$66 = _el$64.nextSibling;
var _el$67 = _el$66.nextSibling;
var [_el$68, _el$69] = _$getNextMarker(_el$67.nextSibling);
_$insert(_el$48, _$createComponent(Link, { children: "new" }), _el$50, _el$51);
_$insert(_el$48, _$createComponent(Link, { children: "comments" }), _el$54, _el$55);
_$insert(_el$48, _$createComponent(Link, { children: "show" }), _el$57, _el$58);
_$insert(_el$48, _$createComponent(Link, { children: "ask" }), _el$61, _el$62);
_$insert(_el$48, _$createComponent(Link, { children: "jobs" }), _el$64, _el$65);
_$insert(_el$48, _$createComponent(Link, { children: "submit" }), _el$68, _el$69);
const template11 = _el$48;
var _el$70 = _$getNextElement(_tmpl$7);
var _el$71 = _el$70.firstChild;
var _el$72 = _el$71.nextSibling;
var [_el$73, _el$74] = _$getNextMarker(_el$72.nextSibling);
var _el$75 = _el$73.nextSibling;
var _el$76 = _el$75.nextSibling;
var [_el$77, _el$78] = _$getNextMarker(_el$76.nextSibling);
var _el$79 = _el$77.nextSibling;
_$insert(_el$70, _$createComponent(Link, { children: "comments" }), _el$73, _el$74);
_$insert(_el$70, _$createComponent(Link, { children: "show" }), _el$77, _el$78);
const template12 = _el$70;
class Template13 {
	render() {
		const _self$ = this;
		_$createComponent(Component, {
			get prop() {
				return _self$.something;
			},
			onClick: () => _self$.shouldStay,
			get children() {
				return _$createComponent(Nested, {
					get prop() {
						return _self$.data;
					},
					get children() {
						return _self$.content;
					}
				});
			}
		});
	}
}
const Template14 = _$createComponent(Component, { get children() {
	return data();
} });
const Template15 = _$createComponent(Component, props);
const Template16 = _$createComponent(Component, _$mergeProps({ something }, props));
const Template17 = _$createComponent(Pre, { get children() {
	return [
		_$getNextElement(_tmpl$8),
		" ",
		_$getNextElement(_tmpl$9),
		" ",
		_$getNextElement(_tmpl$10)
	];
} });
const Template18 = _$createComponent(Pre, { get children() {
	return [
		_$getNextElement(_tmpl$8),
		_$getNextElement(_tmpl$9),
		_$getNextElement(_tmpl$10)
	];
} });
const Template19 = _$createComponent(Component, _$mergeProps(() => {
	return s.dynamic();
}));
const Template20 = _$createComponent(Component, { get ["class"]() {
	return prop.red ? "red" : "green";
} });
const template21 = _$createComponent(Component, _$mergeProps(() => {
	return { get [key()]() {
		return props.value;
	} };
}));
const template22 = _$createComponent(Component, { get passObject() {
	return { ...a };
} });
const template23 = _$createComponent(Component, {
	get disabled() {
		return "t" in test;
	},
	get children() {
		return "t" in test && "true";
	}
});
const template24 = _$createComponent(Component, { get children() {
	return state.dynamic;
} });
const template25 = _$createComponent(Component, { get children() {
	return _$getNextElement(_tmpl$2);
} });
