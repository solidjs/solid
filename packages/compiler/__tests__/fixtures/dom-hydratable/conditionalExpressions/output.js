import { template as _$template } from "r-dom";
import { getNextElement as _$getNextElement } from "r-dom";
import { insert as _$insert } from "r-dom";
import { scope as _$scope } from "r-dom";
import { memo as _$memo } from "r-dom";
import { createComponent as _$createComponent } from "r-dom";
import { effect as _$effect } from "r-dom";
import { setProperty as _$setProperty } from "r-dom";
var _tmpl$ = /* @__PURE__ */ _$template(`<div>`);
var _tmpl$2 = /* @__PURE__ */ _$template(`<div>Output`);
var _el$ = _$getNextElement(_tmpl$);
_$insert(_el$, simple);
const template1 = _el$;
var _el$2 = _$getNextElement(_tmpl$);
_$insert(_el$2, () => {
	return state.dynamic;
});
const template2 = _el$2;
var _el$3 = _$getNextElement(_tmpl$);
_$insert(_el$3, simple ? good : bad);
const template3 = _el$3;
var _el$4 = _$getNextElement(_tmpl$);
_$insert(_el$4, _$scope(() => {
	return simple ? good() : bad;
}));
const template4 = _el$4;
var _el$5 = _$getNextElement(_tmpl$);
_$insert(_el$5, () => {
	return simple ? good.good : bad;
});
const template4a = _el$5;
var _el$6 = _$getNextElement(_tmpl$);
_$insert(_el$6, _$scope((() => {
	var _c$ = _$memo(() => {
		return !!state.dynamic;
	});
	return () => {
		return _c$() ? good() : bad;
	};
})()));
const template5 = _el$6;
var _el$7 = _$getNextElement(_tmpl$);
_$insert(_el$7, (() => {
	var _c$2 = _$memo(() => {
		return !!state.dynamic;
	});
	return () => {
		return _c$2() ? good.good : bad;
	};
})());
const template5a = _el$7;
var _el$8 = _$getNextElement(_tmpl$);
_$insert(_el$8, _$scope((() => {
	var _c$3 = _$memo(() => {
		return !!state.dynamic;
	});
	return () => {
		return _c$3() ? good() : state.dynamic;
	};
})()));
const template6 = _el$8;
var _el$9 = _$getNextElement(_tmpl$);
_$insert(_el$9, (() => {
	var _c$4 = _$memo(() => {
		return !!state.dynamic;
	});
	return () => {
		return _c$4() ? good.good : state.dynamic;
	};
})());
const template6a = _el$9;
var _el$10 = _$getNextElement(_tmpl$);
_$insert(_el$10, _$scope((() => {
	var _c$5 = _$memo(() => {
		return state.count > 5;
	});
	return () => {
		return _c$5() ? _$memo(() => {
			return !!state.dynamic;
		})() ? best : good() : bad;
	};
})()));
const template7 = _el$10;
var _el$11 = _$getNextElement(_tmpl$);
_$insert(_el$11, (() => {
	var _c$6 = _$memo(() => {
		return state.count > 5;
	});
	return () => {
		return _c$6() ? _$memo(() => {
			return !!state.dynamic;
		})() ? best : good.good : bad;
	};
})());
const template7a = _el$11;
var _el$12 = _$getNextElement(_tmpl$);
_$insert(_el$12, _$scope((() => {
	var _c$7 = _$memo(() => {
		return !!(state.dynamic && state.something);
	});
	return () => {
		return _c$7() ? good() : state.dynamic && state.something;
	};
})()));
const template8 = _el$12;
var _el$13 = _$getNextElement(_tmpl$);
_$insert(_el$13, (() => {
	var _c$8 = _$memo(() => {
		return !!(state.dynamic && state.something);
	});
	return () => {
		return _c$8() ? good.good : state.dynamic && state.something;
	};
})());
const template8a = _el$13;
var _el$14 = _$getNextElement(_tmpl$);
_$insert(_el$14, (() => {
	var _c$9 = _$memo(() => {
		return !!state.dynamic;
	});
	return () => {
		return (_c$9() ? good() : state.dynamic) || bad;
	};
})());
const template9 = _el$14;
var _el$15 = _$getNextElement(_tmpl$);
_$insert(_el$15, (() => {
	var _c$10 = _$memo(() => {
		return !!state.dynamic;
	});
	return () => {
		return (_c$10() ? good.good : state.dynamic) || bad;
	};
})());
const template9a = _el$15;
var _el$16 = _$getNextElement(_tmpl$);
_$insert(_el$16, (() => {
	var _c$11 = _$memo(() => {
		return !!state.a;
	});
	return () => {
		return _c$11() ? "a" : _$memo(() => {
			return !!state.b;
		})() ? "b" : state.c ? "c" : "fallback";
	};
})());
const template10 = _el$16;
var _el$17 = _$getNextElement(_tmpl$);
_$insert(_el$17, _$scope((() => {
	var _c$12 = _$memo(() => {
		return !!state.a;
	});
	return () => {
		return _c$12() ? a() : _$memo(() => {
			return !!state.b;
		})() ? b() : state.c ? "c" : "fallback";
	};
})()));
const template11 = _el$17;
var _el$18 = _$getNextElement(_tmpl$);
_$insert(_el$18, (() => {
	var _c$13 = _$memo(() => {
		return !!state.a;
	});
	return () => {
		return _c$13() ? a.a : _$memo(() => {
			return !!state.b;
		})() ? b.b : state.c ? "c" : "fallback";
	};
})());
const template11a = _el$18;
const template12 = _$createComponent(Comp, { get render() {
	return _$memo(() => {
		return !!state.dynamic;
	})() ? good() : bad;
} });
const template12a = _$createComponent(Comp, { get render() {
	return _$memo(() => {
		return !!state.dynamic;
	})() ? good.goood : bad;
} });
// no dynamic predicate
const template13 = _$createComponent(Comp, { get render() {
	return state.dynamic ? good : bad;
} });
const template14 = _$createComponent(Comp, { get render() {
	return _$memo(() => {
		return !!state.dynamic;
	})() ? good() : state.dynamic;
} });
const template14a = _$createComponent(Comp, { get render() {
	return _$memo(() => {
		return !!state.dynamic;
	})() ? good.good : state.dynamic;
} });
// no dynamic predicate
const template15 = _$createComponent(Comp, { get render() {
	return state.dynamic && good;
} });
const template16 = _$createComponent(Comp, { get render() {
	return state.dynamic || good();
} });
const template16a = _$createComponent(Comp, { get render() {
	return state.dynamic || good.good;
} });
const template17 = _$createComponent(Comp, { get render() {
	return _$memo(() => {
		return !!state.dynamic;
	})() ? _$createComponent(Comp, {}) : _$createComponent(Comp, {});
} });
const template18 = _$createComponent(Comp, { get children() {
	return _$memo(() => {
		return !!state.dynamic;
	})() ? _$createComponent(Comp, {}) : _$createComponent(Comp, {});
} });
var _el$19 = _$getNextElement(_tmpl$);
_$effect(() => state.dynamic ? _$createComponent(Comp, {}) : _$createComponent(Comp, {}), (_v$) => {
	_$setProperty(_el$19, "innerHTML", _v$);
});
const template19 = _el$19;
var _el$20 = _$getNextElement(_tmpl$);
_$insert(_el$20, _$scope((() => {
	var _c$14 = _$memo(() => {
		return !!state.dynamic;
	});
	return () => {
		return _c$14() ? _$createComponent(Comp, {}) : _$createComponent(Comp, {});
	};
})()));
const template20 = _el$20;
const template21 = _$createComponent(Comp, { get render() {
	return state?.dynamic ? "a" : "b";
} });
const template22 = _$createComponent(Comp, { get children() {
	return state?.dynamic ? "a" : "b";
} });
var _el$21 = _$getNextElement(_tmpl$);
_$effect(() => state?.dynamic ? "a" : "b", (_v$) => {
	_$setProperty(_el$21, "innerHTML", _v$);
});
const template23 = _el$21;
var _el$22 = _$getNextElement(_tmpl$);
_$insert(_el$22, () => {
	return state?.dynamic ? "a" : "b";
});
const template24 = _el$22;
const template25 = _$createComponent(Comp, { get render() {
	return state.dynamic ?? _$createComponent(Comp, {});
} });
const template26 = _$createComponent(Comp, { get children() {
	return state.dynamic ?? _$createComponent(Comp, {});
} });
var _el$23 = _$getNextElement(_tmpl$);
_$effect(() => state.dynamic ?? _$createComponent(Comp, {}), (_v$) => {
	_$setProperty(_el$23, "innerHTML", _v$);
});
const template27 = _el$23;
var _el$24 = _$getNextElement(_tmpl$);
_$insert(_el$24, _$scope(() => {
	return state.dynamic ?? _$createComponent(Comp, {});
}));
const template28 = _el$24;
var _el$25 = _$getNextElement(_tmpl$);
_$insert(_el$25, _$scope((() => {
	var _c$15 = _$memo(() => {
		return !!thing();
	});
	return () => {
		return (_c$15() ? thing1() : thing()) ?? thing2() ?? thing3();
	};
})()));
const template29 = _el$25;
var _el$26 = _$getNextElement(_tmpl$);
_$insert(_el$26, (() => {
	var _c$16 = _$memo(() => {
		return !!thing.thing;
	});
	return () => {
		return (_c$16() ? thing1.thing1 : thing.thing) ?? thing2.thing2 ?? thing3.thing3;
	};
})());
const template29a = _el$26;
var _el$27 = _$getNextElement(_tmpl$);
_$insert(_el$27, _$scope(() => {
	return thing() || thing1() || thing2();
}));
const template30 = _el$27;
var _el$28 = _$getNextElement(_tmpl$);
_$insert(_el$28, () => {
	return thing.thing || thing1.thing1 || thing2.thing2;
});
const template30a = _el$28;
const template31 = _$createComponent(Comp, { get value() {
	return _$memo(() => {
		return !!count();
	})() ? _$memo(() => {
		return !!count();
	})() ? count() : count() : count();
} });
const template31a = _$createComponent(Comp, { get value() {
	return _$memo(() => {
		return !!count.count;
	})() ? _$memo(() => {
		return !!count.count;
	})() ? count.count : count.count : count.count;
} });
var _el$29 = _$getNextElement(_tmpl$);
_$insert(_el$29, () => {
	return something?.();
});
const template32 = _el$29;
const template33 = _$createComponent(Comp, { get children() {
	return something?.();
} });
const template34 = simple ? good : bad;
const template35 = _$memo(() => {
	return simple ? good() : bad;
});
const template35a = _$memo(() => {
	return simple ? good.good : bad;
});
const template36 = _$memo(() => {
	return _$memo(() => {
		return !!state.dynamic;
	})() ? good() : bad;
});
const template36a = _$memo(() => {
	return _$memo(() => {
		return !!state.dynamic;
	})() ? good.good : bad;
});
const template37 = _$memo(() => {
	return _$memo(() => {
		return !!state.dynamic;
	})() ? good() : state.dynamic;
});
const template37a = _$memo(() => {
	return _$memo(() => {
		return !!state.dynamic;
	})() ? good.good : state.dynamic;
});
const template38 = _$memo(() => {
	return _$memo(() => {
		return state.count > 5;
	})() ? _$memo(() => {
		return !!state.dynamic;
	})() ? best : good() : bad;
});
const template38a = _$memo(() => {
	return _$memo(() => {
		return state.count > 5;
	})() ? _$memo(() => {
		return !!state.dynamic;
	})() ? best : good.good : bad;
});
const template39 = _$memo(() => {
	return _$memo(() => {
		return !!(state.dynamic && state.something);
	})() ? good() : state.dynamic && state.something;
});
const template39a = _$memo(() => {
	return _$memo(() => {
		return !!(state.dynamic && state.something);
	})() ? good.good : state.dynamic && state.something;
});
const template40 = _$memo(() => {
	return (_$memo(() => {
		return !!state.dynamic;
	})() ? good() : state.dynamic) || bad;
});
const template40a = _$memo(() => {
	return (_$memo(() => {
		return !!state.dynamic;
	})() ? good.good : state.dynamic) || bad;
});
const template41 = _$memo(() => {
	return _$memo(() => {
		return !!state.a;
	})() ? "a" : _$memo(() => {
		return !!state.b;
	})() ? "b" : state.c ? "c" : "fallback";
});
const template42 = _$memo(() => {
	return _$memo(() => {
		return !!state.a;
	})() ? a() : _$memo(() => {
		return !!state.b;
	})() ? b() : state.c ? "c" : "fallback";
});
const template42a = _$memo(() => {
	return _$memo(() => {
		return !!state.a;
	})() ? a.a : _$memo(() => {
		return !!state.b;
	})() ? b.b : state.c ? "c" : "fallback";
});
const template43 = _$memo(() => {
	return _$memo(() => {
		return !!obj1.prop;
	})() ? _$memo(() => {
		return !!obj2.prop;
	})() ? _$getNextElement(_tmpl$2) : [] : [];
});
// statically boolean left: memo value IS the expression value, logical form kept
const template77 = _$memo(() => {
	return _$memo(() => {
		return state.count > 5;
	})() && good();
});
const template77a = _$memo(() => {
	return _$memo(() => {
		return !state.hidden;
	})() && good.good;
});
