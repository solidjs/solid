import { template as _$template } from "r-dom";
import { insert as _$insert } from "r-dom";
import { memo as _$memo } from "r-dom";
import { createComponent as _$createComponent } from "r-dom";
import { mergeProps as _$mergeProps } from "r-dom";
import { effect as _$effect } from "r-dom";
import { setAttribute as _$setAttribute } from "r-dom";
var _tmpl$ = /* @__PURE__ */ _$template(`<h1>Welcome`);
var _tmpl$2 = /* @__PURE__ */ _$template(`<p>Sign in`);
var _tmpl$3 = /* @__PURE__ */ _$template(`<div><span>`);
var _tmpl$4 = /* @__PURE__ */ _$template(`<b>total`);
var _tmpl$5 = /* @__PURE__ */ _$template(`<b>`);
var _tmpl$6 = /* @__PURE__ */ _$template(`<i>none`);
var _tmpl$7 = /* @__PURE__ */ _$template(`<i>`);
var _tmpl$8 = /* @__PURE__ */ _$template(`<div>`);
import { Show, createSignal, createMemo } from "solid-js";
import { Show as Visible } from "@solidjs/web";
const [user, setUser] = createSignal();
const total = createMemo(() => 1);
let mutable = createSignal(0)[0];
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
}, "Show", "lowerShow.jsx:10:3");
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
	}, "Show", "lowerShow.jsx:16:5"), _el$4);
	return _el$3;
})();
const InFragment = () => _$createComponent(Show, {
	get when() {
		return total() > 1;
	},
	children: "many"
}, "Show", "lowerShow.jsx:22:5");
const SoleComponentChild = () => _$createComponent(Panel, { get children() {
	return _$createComponent(Show, {
		get when() {
			return total();
		},
		get children() {
			return _tmpl$4();
		}
	}, "Show", "lowerShow.jsx:27:5");
} }, "Panel", "lowerShow.jsx:26:3");
const Renamed = () => _$createComponent(Visible, {
	get when() {
		return user();
	},
	children: "renamed"
}, "Visible", "lowerShow.jsx:32:23");
const Empty = () => _$createComponent(Show, { get when() {
	return user();
} }, "Show", "lowerShow.jsx:33:21");
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
			name: "b.children",
			loc: "lowerShow.jsx:36:68"
		});
		_$effect(() => u().id, (_v$) => {
			_$setAttribute(_el$6, "title", _v$);
		}, {
			name: "b.title",
			loc: "lowerShow.jsx:36:53"
		});
		return _el$6;
	})()
}, "Show", "lowerShow.jsx:36:24");
const CallbackMember = (props) => _$createComponent(Show, {
	get when() {
		return props.user?.profile;
	},
	get fallback() {
		return _tmpl$6();
	},
	children: (profile) => _$createComponent(Card, {
		profile,
		get name() {
			return profile().name;
		}
	}, "Card", "lowerShow.jsx:39:17")
}, "Show", "lowerShow.jsx:38:3");
const Nested = (props) => _$createComponent(Show, {
	get when() {
		return props.a;
	},
	get children() {
		return _$createComponent(Show, {
			get when() {
				return props.b;
			},
			children: (b) => (() => {
				var _el$8 = _tmpl$7();
				_$insert(_el$8, () => {
					return b().c;
				}, undefined, undefined, {
					name: "i.children",
					loc: "lowerShow.jsx:44:35"
				});
				return _el$8;
			})()
		}, "Show", "lowerShow.jsx:44:5");
	}
}, "Show", "lowerShow.jsx:43:3");
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
			name: "b.children",
			loc: "lowerShow.jsx:51:14"
		});
		return _el$9;
	})()
}, "Show", "lowerShow.jsx:50:3");
const Spread = (props) => _$createComponent(Show, _$mergeProps(props, { children: "x" }), "Show", "lowerShow.jsx:54:25");
const Other = () => _$createComponent(Show, {
	get when() {
		return user();
	},
	name: "x",
	children: "x"
}, "Show", "lowerShow.jsx:56:3");
const Bare = () => _$createComponent(Show, {
	when: true,
	children: "x"
}, "Show", "lowerShow.jsx:60:20");
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
			name: "b.children",
			loc: "lowerShow.jsx:62:52"
		});
		return _el$10;
	})()
}, "Show", "lowerShow.jsx:62:23");
const Mutable = () => _$createComponent(Show, {
	get when() {
		return mutable();
	},
	children: (u) => (() => {
		var _el$11 = _tmpl$5();
		_$insert(_el$11, u, undefined, undefined, {
			name: "b.children",
			loc: "lowerShow.jsx:63:55"
		});
		return _el$11;
	})()
}, "Show", "lowerShow.jsx:63:23");
const Block = () => _$createComponent(Show, {
	get when() {
		return user();
	},
	children: (u) => {
		var _el$12 = _tmpl$5();
		_$insert(_el$12, () => {
			return u().name;
		}, undefined, undefined, {
			name: "b.children",
			loc: "lowerShow.jsx:67:17"
		});
		return _el$12;
	}
}, "Show", "lowerShow.jsx:65:3");
const Shadowed = () => _$createComponent(Show, {
	get when() {
		return user();
	},
	children: (u) => (() => {
		var _el$13 = _tmpl$5();
		_$insert(_el$13, () => {
			return [1].map((user) => u().name + user);
		}, undefined, undefined, {
			name: "b.children",
			loc: "lowerShow.jsx:71:53"
		});
		return _el$13;
	})()
}, "Show", "lowerShow.jsx:71:24");
// Kept: a child that could be a function, a non-sole component child, an
// attribute, or inside a JSX expression.
const Render = (props) => _$createComponent(Show, {
	get when() {
		return user();
	},
	get children() {
		return props.render;
	}
}, "Show", "lowerShow.jsx:74:25");
const Siblings = () => _$createComponent(Panel, { get children() {
	return [_$createComponent(Show, {
		get when() {
			return user();
		},
		children: "x"
	}, "Show", "lowerShow.jsx:77:5"), _tmpl$7()];
} }, "Panel", "lowerShow.jsx:76:3");
const Attribute = () => _$createComponent(Panel, { get fallback() {
	return _$createComponent(Show, {
		get when() {
			return user();
		},
		children: "x"
	}, "Show", "lowerShow.jsx:81:42");
} }, "Panel", "lowerShow.jsx:81:25");
const InExpression = (props) => (() => {
	var _el$15 = _tmpl$8();
	_$insert(_el$15, (() => {
		var _c$ = _$memo(() => {
			return !!props.ok;
		});
		return () => {
			return _c$() ? _$createComponent(Show, {
				get when() {
					return user();
				},
				children: "x"
			}, "Show", "lowerShow.jsx:82:49") : props.ok;
		};
	})(), undefined, undefined, {
		name: "div.children",
		loc: "lowerShow.jsx:82:36"
	});
	return _el$15;
})();
// Kept: not Solid's `<Show>`.
const Local = () => {
	const Show = (props) => props.children;
	return _$createComponent(Show, {
		get when() {
			return user();
		},
		children: "x"
	}, "Show", "lowerShow.jsx:86:10");
};
