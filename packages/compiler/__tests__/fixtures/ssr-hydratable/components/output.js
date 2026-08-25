import { memo as _$memo } from "r-server";
import { scope as _$scope } from "r-server";
import { escape as _$escape } from "r-server";
import { ssr as _$ssr } from "r-server";
import { ssrHydrationKey as _$ssrHydrationKey } from "r-server";
import { ssrElement as _$ssrElement } from "r-server";
import { mergeProps as _$mergeProps } from "r-server";
import { applyRef as _$applyRef } from "r-server";
import { For as _$For } from "r-server";
var _v$12, _v$13, _v$14, _v$16, _v$34, _v$35, _v$36, _v$37, _v$38, _v$39, _v$40;
var _tmpl$ = [
	"<div",
	">Hello <!--$-->",
	"<!--/--></div>"
];
var _tmpl$2 = [
	"<div",
	">",
	"</div>"
];
var _tmpl$3 = ["<div", ">From Parent</div>"];
var _tmpl$4 = [
	"<div",
	"><!--$-->",
	"<!--/--><!--$-->",
	"<!--/--><!--$-->",
	"<!--/--></div>"
];
var _tmpl$5 = ["<div", "></div>"];
var _tmpl$6 = [
	"<div",
	"><!--$-->",
	"<!--/--> | <!--$-->",
	"<!--/--> | <!--$-->",
	"<!--/--> | <!--$-->",
	"<!--/--> | <!--$-->",
	"<!--/--> | <!--$-->",
	"<!--/--></div>"
];
var _tmpl$7 = [
	"<div",
	"><!--$-->",
	"<!--/--> | <!--$-->",
	"<!--/--><!--$-->",
	"<!--/--> | <!--$-->",
	"<!--/--><!--$-->",
	"<!--/--> | <!--$-->",
	"<!--/--></div>"
];
var _tmpl$8 = [
	"<div",
	"> | <!--$-->",
	"<!--/--> |  |  | <!--$-->",
	"<!--/--> | </div>"
];
var _tmpl$9 = ["<span", ">1</span>"];
var _tmpl$10 = ["<span", ">2</span>"];
var _tmpl$11 = ["<span", ">3</span>"];
import { Show } from "somewhere";
const Child = (props) => {
	var _v$, _ref$, _v$2, _v$3, _ref$2, _v$4;
	const [s, set] = createSignal();
	return [(_v$ = _$ssrHydrationKey(), _ref$ = props.ref, _v$2 = () => {
		return _$escape(props.name);
	}, _$ssr(_tmpl$, _v$, _v$2)), (_v$3 = _$ssrHydrationKey(), _ref$2 = set, _v$4 = _$scope(() => {
		return _$escape(props.children);
	}), _$ssr(_tmpl$2, _v$3, _v$4))];
};
const template = (props) => {
	var _v$6, _v$8, _v$9;
	let childRef;
	const { content } = props;
	var _v$5 = _$ssrHydrationKey(), _v$7 = _$escape(Child(_$mergeProps({ name: "John" }, props, {
		ref(r$) {
			var _ref$3 = childRef;
			typeof _ref$3 === "function" || Array.isArray(_ref$3) ? _$applyRef(_ref$3, r$) : childRef = r$;
		},
		booleanProperty: true,
		get children() {
			return _v$6 = _$ssrHydrationKey(), _$ssr(_tmpl$3, _v$6);
		}
	}))), _v$10 = _$escape(Child(_$mergeProps({ name: "Jason" }, dynamicSpread, {
		ref(r$) {
			var _ref$4 = props.ref;
			typeof _ref$4 === "function" || Array.isArray(_ref$4) ? _$applyRef(_ref$4, r$) : props.ref = r$;
		},
		get children() {
			return _v$8 = _$ssrHydrationKey(), _v$9 = _$escape(content), _$ssr(_tmpl$2, _v$8, _v$9);
		}
	}))), _v$11 = (() => {
		var _ref$5 = props.consumerRef();
		return _$escape(Context.Consumer({
			ref(r$) {
				(typeof _ref$5 === "function" || Array.isArray(_ref$5)) && _$applyRef(_ref$5, r$);
			},
			children: (context) => context
		}));
	})();
	return _$ssr(_tmpl$4, _v$5, _v$7, _v$10, _v$11);
};
const template2 = Child({
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
const template3 = Child({ get children() {
	return [
		(_v$12 = _$ssrHydrationKey(), _$ssr(_tmpl$5, _v$12)),
		(_v$13 = _$ssrHydrationKey(), _$ssr(_tmpl$5, _v$13)),
		(_v$14 = _$ssrHydrationKey(), _$ssr(_tmpl$5, _v$14)),
		"After"
	];
} });
const [s, set] = createSignal();
const template4 = Child({
	ref: set,
	get children() {
		var _v$15 = _$ssrHydrationKey();
		return _$ssr(_tmpl$5, _v$15);
	}
});
const template5 = Child({
	get dynamic() {
		return state.dynamic;
	},
	get children() {
		return state.dynamic;
	}
});
// builtIns
const template6 = _$For({
	get each() {
		return state.list;
	},
	get fallback() {
		return Loading({});
	},
	children: (item) => Show({
		get when() {
			return state.condition;
		},
		children: item
	})
});
const template7 = Child({ get children() {
	return [(_v$16 = _$ssrHydrationKey(), _$ssr(_tmpl$5, _v$16)), _$memo(() => {
		return _$escape(state.dynamic);
	})];
} });
const template8 = Child({ get children() {
	return [(item) => item, (item) => item];
} });
const template9 = _garbage({ children: "Hi" });
var _v$17 = _$ssrHydrationKey(), _v$18 = _$escape(Link({ children: "new" })), _v$19 = _$escape(Link({ children: "comments" })), _v$20 = _$escape(Link({ children: "show" })), _v$21 = _$escape(Link({ children: "ask" })), _v$22 = _$escape(Link({ children: "jobs" })), _v$23 = _$escape(Link({ children: "submit" }));
const template10 = _$ssr(_tmpl$6, _v$17, _v$18, _v$19, _v$20, _v$21, _v$22, _v$23);
var _v$24 = _$ssrHydrationKey(), _v$25 = _$escape(Link({ children: "new" })), _v$26 = _$escape(Link({ children: "comments" })), _v$27 = _$escape(Link({ children: "show" })), _v$28 = _$escape(Link({ children: "ask" })), _v$29 = _$escape(Link({ children: "jobs" })), _v$30 = _$escape(Link({ children: "submit" }));
const template11 = _$ssr(_tmpl$7, _v$24, _v$25, _v$26, _v$27, _v$28, _v$29, _v$30);
var _v$31 = _$ssrHydrationKey(), _v$32 = _$escape(Link({ children: "comments" })), _v$33 = _$escape(Link({ children: "show" }));
const template12 = _$ssr(_tmpl$8, _v$31, _v$32, _v$33);
class Template13 {
	render() {
		const _self$ = this;
		Component({
			get prop() {
				return _self$.something;
			},
			onClick: () => _self$.shouldStay,
			get children() {
				return Nested({
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
const Template14 = Component({ get children() {
	return data();
} });
const Template15 = Component(props);
const Template16 = Component(_$mergeProps({ something }, props));
const Template17 = Pre({ get children() {
	return [
		(_v$34 = _$ssrHydrationKey(), _$ssr(_tmpl$9, _v$34)),
		" ",
		(_v$35 = _$ssrHydrationKey(), _$ssr(_tmpl$10, _v$35)),
		" ",
		(_v$36 = _$ssrHydrationKey(), _$ssr(_tmpl$11, _v$36))
	];
} });
const Template18 = Pre({ get children() {
	return [
		(_v$37 = _$ssrHydrationKey(), _$ssr(_tmpl$9, _v$37)),
		(_v$38 = _$ssrHydrationKey(), _$ssr(_tmpl$10, _v$38)),
		(_v$39 = _$ssrHydrationKey(), _$ssr(_tmpl$11, _v$39))
	];
} });
const Template19 = Component(_$mergeProps(() => {
	return s.dynamic();
}));
const Template20 = Component({ get ["class"]() {
	return prop.red ? "red" : "green";
} });
const template21 = Component(_$mergeProps(() => {
	return { get [key()]() {
		return props.value;
	} };
}));
const template22 = Component({ get passObject() {
	return { ...a };
} });
const template23 = Component({
	get disabled() {
		return "t" in test;
	},
	get children() {
		return "t" in test && "true";
	}
});
const template24 = Component({ get children() {
	return state.dynamic;
} });
const template25 = Component({ get children() {
	return _v$40 = _$ssrHydrationKey(), _$ssr(_tmpl$5, _v$40);
} });
function MyComponent(props) {
	let el;
	const others = omit(props, "children");
	return _$ssrElement("div", others, () => {
		return _$scope(() => {
			return _$escape(props.children);
		});
	}, true);
}
