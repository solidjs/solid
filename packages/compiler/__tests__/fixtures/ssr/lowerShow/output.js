import { memo as _$memo } from "r-server";
import { escape as _$escape } from "r-server";
import { ssr as _$ssr } from "r-server";
import { ssrAttribute as _$ssrAttribute } from "r-server";
import { mergeProps as _$mergeProps } from "r-server";
var _tmpl$ = "<h1>Welcome</h1>";
var _tmpl$2 = "<label>Sign in</label>";
var _tmpl$3 = ["<div>", "<span></span></div>"];
var _tmpl$4 = "<span>total</span>";
var _tmpl$5 = [
	"<span",
	">",
	"</span>"
];
var _tmpl$6 = "<label>none</label>";
var _tmpl$7 = ["<label>", "</label>"];
var _tmpl$8 = ["<span>", "</span>"];
var _tmpl$9 = "<label></label>";
var _tmpl$10 = ["<div>", "</div>"];
var _m$ = Symbol();
var _d$ = {
	get() {
		return _$memo(() => {
			return _$memo(() => {
				return !!total();
			})() ? _$ssr(_tmpl$4) : void 0;
		});
	},
	enumerable: true,
	configurable: true
};
function _P$() {
	Object.defineProperty(this, "children", _d$);
}
_P$.prototype = Object.prototype;
var _d$2 = {
	get() {
		const props = this[_m$];
		return (props.user?.profile).name;
	},
	enumerable: true,
	configurable: true
};
function _P$2(_p, _p2) {
	this[_m$] = _p;
	this.profile = _p2;
	Object.defineProperty(this, "name", _d$2);
}
_P$2.prototype = Object.prototype;
var _d$3 = {
	get() {
		return user();
	},
	enumerable: true,
	configurable: true
};
function _P$3(_p3, _p4) {
	Object.defineProperty(this, "when", _d$3);
	this.keyed = _p3;
	this.children = _p4;
}
_P$3.prototype = Object.prototype;
var _d$4 = {
	get() {
		return user();
	},
	enumerable: true,
	configurable: true
};
function _P$4(_p5, _p6) {
	Object.defineProperty(this, "when", _d$4);
	this.name = _p5;
	this.children = _p6;
}
_P$4.prototype = Object.prototype;
var _d$5 = {
	get() {
		return load();
	},
	enumerable: true,
	configurable: true
};
function _P$5(_p7) {
	Object.defineProperty(this, "when", _d$5);
	this.children = _p7;
}
_P$5.prototype = Object.prototype;
var _d$6 = {
	get() {
		return mutable();
	},
	enumerable: true,
	configurable: true
};
function _P$6(_p8) {
	Object.defineProperty(this, "when", _d$6);
	this.children = _p8;
}
_P$6.prototype = Object.prototype;
var _d$7 = {
	get() {
		return user();
	},
	enumerable: true,
	configurable: true
};
function _P$7(_p9) {
	Object.defineProperty(this, "when", _d$7);
	this.children = _p9;
}
_P$7.prototype = Object.prototype;
var _d$8 = {
	get() {
		return user();
	},
	enumerable: true,
	configurable: true
};
function _P$8(_p0) {
	Object.defineProperty(this, "when", _d$8);
	this.children = _p0;
}
_P$8.prototype = Object.prototype;
var _d$9 = {
	get() {
		return user();
	},
	enumerable: true,
	configurable: true
}, _d$10 = {
	get() {
		const props = this[_m$];
		return props.render;
	},
	enumerable: true,
	configurable: true
};
function _P$9(_p1) {
	this[_m$] = _p1;
	Object.defineProperty(this, "when", _d$9);
	Object.defineProperty(this, "children", _d$10);
}
_P$9.prototype = Object.prototype;
var _d$11 = {
	get() {
		return user();
	},
	enumerable: true,
	configurable: true
};
function _P$10(_p10) {
	Object.defineProperty(this, "when", _d$11);
	this.children = _p10;
}
_P$10.prototype = Object.prototype;
var _d$12 = {
	get() {
		return [Show(new _P$10("x")), _$ssr(_tmpl$9)];
	},
	enumerable: true,
	configurable: true
};
function _P$11() {
	Object.defineProperty(this, "children", _d$12);
}
_P$11.prototype = Object.prototype;
var _d$13 = {
	get() {
		return user();
	},
	enumerable: true,
	configurable: true
};
function _P$12(_p11) {
	Object.defineProperty(this, "when", _d$13);
	this.children = _p11;
}
_P$12.prototype = Object.prototype;
var _d$14 = {
	get() {
		return Show(new _P$12("x"));
	},
	enumerable: true,
	configurable: true
};
function _P$13() {
	Object.defineProperty(this, "fallback", _d$14);
}
_P$13.prototype = Object.prototype;
var _d$15 = {
	get() {
		return user();
	},
	enumerable: true,
	configurable: true
};
function _P$14(_p12) {
	Object.defineProperty(this, "when", _d$15);
	this.children = _p12;
}
_P$14.prototype = Object.prototype;
var _d$16 = {
	get() {
		return user();
	},
	enumerable: true,
	configurable: true
};
function _P$15(_p13) {
	Object.defineProperty(this, "when", _d$16);
	this.children = _p13;
}
_P$15.prototype = Object.prototype;
import { Show, createSignal, createMemo } from "solid-js";
import { Show as Visible } from "@solidjs/web";
const [user, setUser] = createSignal();
const total = createMemo(() => 1);
let mutable = createSignal(0)[0];
// Lowered: JSX children, with and without a fallback.
const Root = () => _$memo(() => {
	return _$memo(() => {
		return !!user();
	})() ? _$ssr(_tmpl$) : _$ssr(_tmpl$2);
});
const InElement = (props) => {
	var _v$;
	return _v$ = (() => {
		var _c$ = _$memo(() => {
			return !!props.open;
		});
		return () => {
			return _c$() ? _$escape(["hi ", _$memo(() => {
				return props.name;
			})]) : void 0;
		};
	})(), _$ssr(_tmpl$3, _v$);
};
const InFragment = () => _$memo(() => {
	return _$memo(() => {
		return total() > 1;
	})() ? "many" : void 0;
});
const SoleComponentChild = () => Panel(new _P$());
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
	var _v$2, _v$3;
	return _$memo(() => {
		return !!user();
	})() ? (_v$2 = () => {
		return _$ssrAttribute("title", _$escape(user().id, true));
	}, _v$3 = () => {
		return _$escape(user().name);
	}, _$ssr(_tmpl$5, _v$2, _v$3)) : void 0;
});
const CallbackMember = (props) => _$memo(() => {
	return _$memo(() => {
		return !!props.user?.profile;
	})() ? Card(new _P$2(props, () => {
		return props.user?.profile;
	})) : _$ssr(_tmpl$6);
});
const Nested = (props) => _$memo(() => {
	return _$memo(() => {
		return !!props.a;
	})() ? _$memo(() => {
		var _v$4;
		return _$memo(() => {
			return !!props.b;
		})() ? (_v$4 = () => {
			return _$escape(props.b.c);
		}, _$ssr(_tmpl$7, _v$4)) : void 0;
	}) : void 0;
});
// Kept: keyed, a spread, another prop, a bare or string attribute.
const Keyed = () => Show(new _P$3(true, (u) => {
	var _v$5;
	return _v$5 = () => {
		return _$escape(u.name);
	}, _$ssr(_tmpl$8, _v$5);
}));
const Spread = (props) => Show(_$mergeProps(props, { children: "x" }));
const Other = () => Show(new _P$4("x", "x"));
const Bare = () => Show({
	when: true,
	children: "x"
});
// Kept: a callback with a `when` that is not a plain read, or a block body.
const Fetched = () => Show(new _P$5((u) => {
	var _v$6;
	return _v$6 = () => {
		return _$escape(u().name);
	}, _$ssr(_tmpl$8, _v$6);
}));
const Mutable = () => Show(new _P$6((u) => {
	var _v$7;
	return _v$7 = () => {
		return _$escape(u());
	}, _$ssr(_tmpl$8, _v$7);
}));
const Block = () => Show(new _P$7((u) => {
	var _v$8 = () => {
		return _$escape(u().name);
	};
	return _$ssr(_tmpl$8, _v$8);
}));
const Shadowed = () => Show(new _P$8((u) => {
	var _v$9;
	return _v$9 = () => {
		return _$escape([1].map((user) => u().name + user));
	}, _$ssr(_tmpl$8, _v$9);
}));
// Kept: a child that could be a function, a non-sole component child, an
// attribute, or inside a JSX expression.
const Render = (props) => Show(new _P$9(props));
const Siblings = () => Panel(new _P$11());
const Attribute = () => Panel(new _P$13());
const InExpression = (props) => {
	var _v$10;
	return _v$10 = (() => {
		var _c$2 = _$memo(() => {
			return !!props.ok;
		});
		return () => {
			return _c$2() ? _$escape(Show(new _P$14("x"))) : _$escape(props.ok);
		};
	})(), _$ssr(_tmpl$10, _v$10);
};
// Kept: not Solid's `<Show>`.
const Local = () => {
	const Show = (props) => props.children;
	return Show(new _P$15("x"));
};
