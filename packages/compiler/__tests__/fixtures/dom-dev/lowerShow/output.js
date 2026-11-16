import { template as _$template } from "r-dom";
import { insert as _$insert } from "r-dom";
import { memo as _$memo } from "r-dom";
import { createComponent as _$createComponent } from "r-dom";
import { mergeProps as _$mergeProps } from "r-dom";
import { effect as _$effect } from "r-dom";
import { setAttribute as _$setAttribute } from "r-dom";
var _tmpl$ = /* @__PURE__ */ _$template(`<h1>Welcome`);
var _tmpl$2 = /* @__PURE__ */ _$template(`<label>Sign in`);
var _tmpl$3 = /* @__PURE__ */ _$template(`<div><span>`);
var _tmpl$4 = /* @__PURE__ */ _$template(`<span>total`);
var _tmpl$5 = /* @__PURE__ */ _$template(`<span>`);
var _tmpl$6 = /* @__PURE__ */ _$template(`<label>none`);
var _tmpl$7 = /* @__PURE__ */ _$template(`<label>`);
var _tmpl$8 = /* @__PURE__ */ _$template(`<div>`);
import { Show, createSignal, createMemo, createStore } from "solid-js";
import { Show as Visible } from "@solidjs/web";
const [user, setUser] = createSignal();
const total = createMemo(() => 1);
let mutable = createSignal(0)[0];
const [state] = createStore({ user: { profile: { name: "" } } });
// Lowered: JSX children, with and without a fallback.
const Root = () => _$createComponent(Show, {
	get when() {
		return user();
	},
	get fallback() {
		return _tmpl$2();
	},
	get children() {
		return _tmpl$();
	}
}, "Show", "lowerShow.jsx:11:3");
const InElement = (props) => (() => {
	var _el$3 = _tmpl$3();
	var _el$4 = _el$3.firstChild;
	_$insert(_el$3, _$createComponent(Show, {
		get when() {
			return props.open;
		},
		get children() {
			return ["hi ", _$memo(() => {
				return props.name;
			})];
		}
	}, "Show", "lowerShow.jsx:17:5"), _el$4);
	return _el$3;
})();
const InFragment = () => _$createComponent(Show, {
	get when() {
		return total() > 1;
	},
	children: "many"
}, "Show", "lowerShow.jsx:23:5");
const SoleComponentChild = () => _$createComponent(Panel, { get children() {
	return _$createComponent(Show, {
		get when() {
			return total();
		},
		get children() {
			return _tmpl$4();
		}
	}, "Show", "lowerShow.jsx:28:5");
} }, "Panel", "lowerShow.jsx:27:3");
const Renamed = () => _$createComponent(Visible, {
	get when() {
		return user();
	},
	children: "renamed"
}, "Visible", "lowerShow.jsx:33:23");
const Empty = () => _$createComponent(Show, { get when() {
	return user();
} }, "Show", "lowerShow.jsx:34:21");
// Lowered: a callback whose `when` is a plain read; `u()` reads `when`.
const Callback = () => _$createComponent(Show, {
	get when() {
		return user();
	},
	children: (u) => (() => {
		var _el$6 = _tmpl$5();
		_$insert(_el$6, () => {
			return u().name;
		}, undefined, undefined, {
			name: "span.children",
			loc: "lowerShow.jsx:37:71"
		});
		_$effect(() => u().id, (_v$) => {
			_$setAttribute(_el$6, "title", _v$);
		}, {
			name: "span.title",
			loc: "lowerShow.jsx:37:56"
		});
		return _el$6;
	})()
}, "Show", "lowerShow.jsx:37:24");
const CallbackMember = () => _$createComponent(Show, {
	get when() {
		return state.user?.profile;
	},
	get fallback() {
		return _tmpl$6();
	},
	children: (profile) => _$createComponent(Card, {
		profile,
		get name() {
			return profile().name;
		}
	}, "Card", "lowerShow.jsx:40:17")
}, "Show", "lowerShow.jsx:39:3");
const Nested = () => _$createComponent(Show, {
	get when() {
		return user();
	},
	get children() {
		return _$createComponent(Show, {
			get when() {
				return state.user;
			},
			children: (b) => (() => {
				var _el$8 = _tmpl$7();
				_$insert(_el$8, () => {
					return b().profile.name;
				}, undefined, undefined, {
					name: "label.children",
					loc: "lowerShow.jsx:45:42"
				});
				return _el$8;
			})()
		}, "Show", "lowerShow.jsx:45:5");
	}
}, "Show", "lowerShow.jsx:44:3");
// Kept: keyed, a spread, another prop, a bare or string attribute.
const Keyed = () => _$createComponent(Show, {
	get when() {
		return user();
	},
	keyed: true,
	children: (u) => (() => {
		var _el$9 = _tmpl$5();
		_$insert(_el$9, () => {
			return u.name;
		}, undefined, undefined, {
			name: "span.children",
			loc: "lowerShow.jsx:52:17"
		});
		return _el$9;
	})()
}, "Show", "lowerShow.jsx:51:3");
const Spread = (props) => _$createComponent(Show, _$mergeProps(props, { children: "x" }), "Show", "lowerShow.jsx:55:25");
const Other = () => _$createComponent(Show, {
	get when() {
		return user();
	},
	name: "x",
	children: "x"
}, "Show", "lowerShow.jsx:57:3");
const Bare = () => _$createComponent(Show, {
	when: true,
	children: "x"
}, "Show", "lowerShow.jsx:61:20");
// Kept: a callback with a `when` that is not a plain read, or a block body.
const Fetched = () => _$createComponent(Show, {
	get when() {
		return load();
	},
	children: (u) => (() => {
		var _el$10 = _tmpl$5();
		_$insert(_el$10, () => {
			return u().name;
		}, undefined, undefined, {
			name: "span.children",
			loc: "lowerShow.jsx:63:55"
		});
		return _el$10;
	})()
}, "Show", "lowerShow.jsx:63:23");
const Mutable = () => _$createComponent(Show, {
	get when() {
		return mutable();
	},
	children: (u) => (() => {
		var _el$11 = _tmpl$5();
		_$insert(_el$11, u, undefined, undefined, {
			name: "span.children",
			loc: "lowerShow.jsx:64:58"
		});
		return _el$11;
	})()
}, "Show", "lowerShow.jsx:64:23");
// Kept: a prop's getter can make its JSX again on each read (#4936).
const PropChild = (props) => _$createComponent(Show, {
	get when() {
		return props.children;
	},
	children: (child) => (() => {
		var _el$12 = _tmpl$7();
		_$insert(_el$12, child, undefined, undefined, {
			name: "label.children",
			loc: "lowerShow.jsx:66:73"
		});
		return _el$12;
	})()
}, "Show", "lowerShow.jsx:66:28");
const PropMember = (props) => _$createComponent(Show, {
	get when() {
		return props.user?.profile;
	},
	children: (p) => (() => {
		var _el$13 = _tmpl$5();
		_$insert(_el$13, () => {
			return p().name;
		}, undefined, undefined, {
			name: "span.children",
			loc: "lowerShow.jsx:67:74"
		});
		return _el$13;
	})()
}, "Show", "lowerShow.jsx:67:29");
const Block = () => _$createComponent(Show, {
	get when() {
		return user();
	},
	children: (u) => {
		var _el$14 = _tmpl$5();
		_$insert(_el$14, () => {
			return u().name;
		}, undefined, undefined, {
			name: "span.children",
			loc: "lowerShow.jsx:71:20"
		});
		return _el$14;
	}
}, "Show", "lowerShow.jsx:69:3");
const Shadowed = () => _$createComponent(Show, {
	get when() {
		return user();
	},
	children: (u) => (() => {
		var _el$15 = _tmpl$5();
		_$insert(_el$15, () => {
			return [1].map((user) => u().name + user);
		}, undefined, undefined, {
			name: "span.children",
			loc: "lowerShow.jsx:76:35"
		});
		return _el$15;
	})()
}, "Show", "lowerShow.jsx:76:3");
// Kept: a child that could be a function, a non-sole component child, an
// attribute, or inside a JSX expression.
const Render = (props) => _$createComponent(Show, {
	get when() {
		return user();
	},
	get children() {
		return props.render;
	}
}, "Show", "lowerShow.jsx:80:25");
const Siblings = () => _$createComponent(Panel, { get children() {
	return [_$createComponent(Show, {
		get when() {
			return user();
		},
		children: "x"
	}, "Show", "lowerShow.jsx:83:5"), _tmpl$7()];
} }, "Panel", "lowerShow.jsx:82:3");
const Attribute = () => _$createComponent(Panel, { get fallback() {
	return _$createComponent(Show, {
		get when() {
			return user();
		},
		children: "x"
	}, "Show", "lowerShow.jsx:87:42");
} }, "Panel", "lowerShow.jsx:87:25");
const InExpression = (props) => (() => {
	var _el$17 = _tmpl$8();
	_$insert(_el$17, (() => {
		var _c$ = _$memo(() => {
			return !!props.ok;
		});
		return () => {
			return _c$() ? _$createComponent(Show, {
				get when() {
					return user();
				},
				children: "x"
			}, "Show", "lowerShow.jsx:88:49") : props.ok;
		};
	})(), undefined, undefined, {
		name: "div.children",
		loc: "lowerShow.jsx:88:36"
	});
	return _el$17;
})();
// Kept: not Solid's `<Show>`.
const Local = () => {
	const Show = (props) => props.children;
	return _$createComponent(Show, {
		get when() {
			return user();
		},
		children: "x"
	}, "Show", "lowerShow.jsx:92:10");
};
