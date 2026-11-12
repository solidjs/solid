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
import { Show, createSignal, createMemo } from "solid-js";
import { Show as Visible } from "@solidjs/web";
const [user, setUser] = createSignal();
const total = createMemo(() => 1);
let mutable = createSignal(0)[0];
// Lowered: JSX children, with and without a fallback.
const Root = () => _$memo(() => {
	return _$memo(() => {
		return !!user();
	})() ? _tmpl$() : _tmpl$2();
});
const InElement = (props) => (() => {
	var _el$3 = _tmpl$3();
	var _el$4 = _el$3.firstChild;
	_$insert(_el$3, (() => {
		var _c$ = _$memo(() => {
			return !!props.open;
		});
		return () => {
			return _c$() ? ["hi ", _$memo(() => {
				return props.name;
			})] : void 0;
		};
	})(), _el$4);
	return _el$3;
})();
const InFragment = () => _$memo(() => {
	return _$memo(() => {
		return total() > 1;
	})() ? "many" : void 0;
});
const SoleComponentChild = () => _$createComponent(Panel, { get children() {
	return _$memo(() => {
		return _$memo(() => {
			return !!total();
		})() ? _tmpl$4() : void 0;
	});
} });
const Renamed = () => _$memo(() => {
	return _$memo(() => {
		return !!user();
	})() ? "renamed" : void 0;
});
const Empty = () => _$memo(() => {
	return user() ? void 0 : void 0;
});
// Lowered: a callback whose `when` is a plain read; `u()` reads `when`.
const Callback = () => _$memo(() => {
	return _$memo(() => {
		return !!user();
	})() ? (() => {
		var _el$6 = _tmpl$5();
		_$insert(_el$6, () => {
			return user().name;
		});
		_$effect(() => user().id, (_v$) => {
			_$setAttribute(_el$6, "title", _v$);
		});
		return _el$6;
	})() : void 0;
});
const CallbackMember = (props) => _$memo(() => {
	return _$memo(() => {
		return !!props.user?.profile;
	})() ? _$createComponent(Card, {
		profile: () => {
			return props.user?.profile;
		},
		get name() {
			return (props.user?.profile).name;
		}
	}) : _tmpl$6();
});
const Nested = (props) => _$memo(() => {
	return _$memo(() => {
		return !!props.a;
	})() ? _$memo(() => {
		return _$memo(() => {
			return !!props.b;
		})() ? (() => {
			var _el$8 = _tmpl$7();
			_$insert(_el$8, () => {
				return props.b.c;
			});
			return _el$8;
		})() : void 0;
	}) : void 0;
});
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
		});
		return _el$9;
	})()
});
const Spread = (props) => _$createComponent(Show, _$mergeProps(props, { children: "x" }));
const Other = () => _$createComponent(Show, {
	get when() {
		return user();
	},
	name: "x",
	children: "x"
});
const Bare = () => _$createComponent(Show, {
	when: true,
	children: "x"
});
// Kept: a callback with a `when` that is not a plain read, or a block body.
const Fetched = () => _$createComponent(Show, {
	get when() {
		return load();
	},
	children: (u) => (() => {
		var _el$10 = _tmpl$5();
		_$insert(_el$10, () => {
			return u().name;
		});
		return _el$10;
	})()
});
const Mutable = () => _$createComponent(Show, {
	get when() {
		return mutable();
	},
	children: (u) => (() => {
		var _el$11 = _tmpl$5();
		_$insert(_el$11, u);
		return _el$11;
	})()
});
const Block = () => _$createComponent(Show, {
	get when() {
		return user();
	},
	children: (u) => {
		var _el$12 = _tmpl$5();
		_$insert(_el$12, () => {
			return u().name;
		});
		return _el$12;
	}
});
const Shadowed = () => _$createComponent(Show, {
	get when() {
		return user();
	},
	children: (u) => (() => {
		var _el$13 = _tmpl$5();
		_$insert(_el$13, () => {
			return [1].map((user) => u().name + user);
		});
		return _el$13;
	})()
});
// Kept: a child that could be a function, a non-sole component child, an
// attribute, or inside a JSX expression.
const Render = (props) => _$createComponent(Show, {
	get when() {
		return user();
	},
	get children() {
		return props.render;
	}
});
const Siblings = () => _$createComponent(Panel, { get children() {
	return [_$createComponent(Show, {
		get when() {
			return user();
		},
		children: "x"
	}), _tmpl$7()];
} });
const Attribute = () => _$createComponent(Panel, { get fallback() {
	return _$createComponent(Show, {
		get when() {
			return user();
		},
		children: "x"
	});
} });
const InExpression = (props) => (() => {
	var _el$15 = _tmpl$8();
	_$insert(_el$15, (() => {
		var _c$2 = _$memo(() => {
			return !!props.ok;
		});
		return () => {
			return _c$2() ? _$createComponent(Show, {
				get when() {
					return user();
				},
				children: "x"
			}) : props.ok;
		};
	})());
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
	});
};
