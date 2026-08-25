import { template as _$template } from "r-dom";
import { insert as _$insert } from "r-dom";
import { createComponent as _$createComponent } from "r-dom";
import { mergeProps as _$mergeProps } from "r-dom";
import { applyRef as _$applyRef } from "r-dom";
import { ref as _$ref } from "r-dom";
import { For as _$For } from "r-dom";
var _tmpl$ = /* @__PURE__ */ _$template(`<div>Hello `);
var _tmpl$2 = /* @__PURE__ */ _$template(`<div>`);
var _tmpl$3 = /* @__PURE__ */ _$template(`<div>From Parent`);
var _tmpl$4 = /* @__PURE__ */ _$template(`<div><!><!><!>`);
var _tmpl$5 = /* @__PURE__ */ _$template(`<div> | <!> | <!> | <!> | <!> | <!>`);
var _tmpl$6 = /* @__PURE__ */ _$template(`<div> | <!><!> | <!><!> | <!>`);
var _tmpl$7 = /* @__PURE__ */ _$template(`<div> | <!> |  |  | <!> | `);
var _tmpl$8 = /* @__PURE__ */ _$template(`<span>1`);
var _tmpl$9 = /* @__PURE__ */ _$template(`<span>2`);
var _tmpl$10 = /* @__PURE__ */ _$template(`<span>3`);
import { Show } from "somewhere";
const Child = (props) => {
	const [s, set] = createSignal();
	return [(() => {
		var _el$ = _tmpl$();
		var _el$2 = _el$.firstChild;
		var _ref$ = props.ref;
		typeof _ref$ === "function" || Array.isArray(_ref$) ? _$ref(() => {
			return _ref$;
		}, _el$) : props.ref = _el$;
		_$insert(_el$, () => {
			return props.name;
		}, null);
		return _el$;
	})(), (() => {
		var _el$3 = _tmpl$2();
		_$ref(() => {
			return set;
		}, _el$3);
		_$insert(_el$3, () => {
			return props.children;
		});
		return _el$3;
	})()];
};
const template = (props) => {
	let childRef;
	const { content } = props;
	var _el$4 = _tmpl$4();
	var _el$6 = _el$4.firstChild;
	var _el$8 = _el$6.nextSibling;
	var _el$9 = _el$8.nextSibling;
	_$insert(_el$4, _$createComponent(Child, _$mergeProps({ name: "John" }, props, {
		ref(r$) {
			var _ref$2 = childRef;
			typeof _ref$2 === "function" || Array.isArray(_ref$2) ? _$applyRef(_ref$2, r$) : childRef = r$;
		},
		booleanProperty: true,
		get children() {
			return _tmpl$3();
		}
	})), _el$6);
	_$insert(_el$4, _$createComponent(Child, _$mergeProps({ name: "Jason" }, dynamicSpread, {
		ref(r$) {
			var _ref$3 = props.ref;
			typeof _ref$3 === "function" || Array.isArray(_ref$3) ? _$applyRef(_ref$3, r$) : props.ref = r$;
		},
		get children() {
			var _el$7 = _tmpl$2();
			_$insert(_el$7, content);
			return _el$7;
		}
	})), _el$8);
	_$insert(_el$4, (() => {
		var _ref$4 = props.consumerRef();
		return _$createComponent(Context.Consumer, {
			ref(r$) {
				(typeof _ref$4 === "function" || Array.isArray(_ref$4)) && _$applyRef(_ref$4, r$);
			},
			children: (context) => context
		});
	})(), _el$9);
	return _el$4;
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
		_tmpl$2(),
		_tmpl$2(),
		_tmpl$2(),
		"After"
	];
} });
const [s, set] = createSignal();
const template4 = _$createComponent(Child, {
	ref: set,
	get children() {
		return _tmpl$2();
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
	return [_tmpl$2(), () => {
		return state.dynamic;
	}];
} });
const template8 = _$createComponent(Child, { get children() {
	return [(item) => item, (item) => item];
} });
const template9 = _$createComponent(_garbage, { children: "Hi" });
var _el$15 = _tmpl$5();
var _el$16 = _el$15.firstChild;
var _el$17 = _el$16.nextSibling;
var _el$18 = _el$17.nextSibling;
var _el$19 = _el$18.nextSibling;
var _el$20 = _el$19.nextSibling;
var _el$21 = _el$20.nextSibling;
var _el$22 = _el$21.nextSibling;
var _el$23 = _el$22.nextSibling;
var _el$24 = _el$23.nextSibling;
var _el$25 = _el$24.nextSibling;
_$insert(_el$15, _$createComponent(Link, { children: "new" }), _el$15.firstChild);
_$insert(_el$15, _$createComponent(Link, { children: "comments" }), _el$17);
_$insert(_el$15, _$createComponent(Link, { children: "show" }), _el$19);
_$insert(_el$15, _$createComponent(Link, { children: "ask" }), _el$21);
_$insert(_el$15, _$createComponent(Link, { children: "jobs" }), _el$23);
_$insert(_el$15, _$createComponent(Link, { children: "submit" }), _el$25);
const template10 = _el$15;
var _el$26 = _tmpl$6();
var _el$27 = _el$26.firstChild;
var _el$28 = _el$27.nextSibling;
var _el$29 = _el$28.nextSibling;
var _el$30 = _el$29.nextSibling;
var _el$31 = _el$30.nextSibling;
var _el$32 = _el$31.nextSibling;
var _el$33 = _el$32.nextSibling;
var _el$34 = _el$33.nextSibling;
_$insert(_el$26, _$createComponent(Link, { children: "new" }), _el$26.firstChild);
_$insert(_el$26, _$createComponent(Link, { children: "comments" }), _el$28);
_$insert(_el$26, _$createComponent(Link, { children: "show" }), _el$29);
_$insert(_el$26, _$createComponent(Link, { children: "ask" }), _el$31);
_$insert(_el$26, _$createComponent(Link, { children: "jobs" }), _el$32);
_$insert(_el$26, _$createComponent(Link, { children: "submit" }), _el$34);
const template11 = _el$26;
var _el$35 = _tmpl$7();
var _el$36 = _el$35.firstChild;
var _el$37 = _el$36.nextSibling;
var _el$38 = _el$37.nextSibling;
var _el$39 = _el$38.nextSibling;
var _el$40 = _el$39.nextSibling;
_$insert(_el$35, _$createComponent(Link, { children: "comments" }), _el$37);
_$insert(_el$35, _$createComponent(Link, { children: "show" }), _el$39);
const template12 = _el$35;
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
		_tmpl$8(),
		" ",
		_tmpl$9(),
		" ",
		_tmpl$10()
	];
} });
const Template18 = _$createComponent(Pre, { get children() {
	return [
		_tmpl$8(),
		_tmpl$9(),
		_tmpl$10()
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
