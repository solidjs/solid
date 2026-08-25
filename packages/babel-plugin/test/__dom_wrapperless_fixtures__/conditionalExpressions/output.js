import { template as _$template } from "r-dom";
import { createComponent as _$createComponent } from "r-dom";
import { insert as _$insert } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(`<div>`),
  _tmpl$2 = /*#__PURE__*/ _$template(`<div>Output`);
var _el$ = _tmpl$();
_$insert(_el$, simple);
const template1 = _el$;
var _el$2 = _tmpl$();
_$insert(_el$2, () => state.dynamic);
const template2 = _el$2;
var _el$3 = _tmpl$();
_$insert(_el$3, simple ? good : bad);
const template3 = _el$3;
var _el$4 = _tmpl$();
_$insert(_el$4, () => (simple ? good() : bad));
const template4 = _el$4;
var _el$5 = _tmpl$();
_$insert(_el$5, () => (state.dynamic ? good() : bad));
const template5 = _el$5;
var _el$6 = _tmpl$();
_$insert(_el$6, () => state.dynamic && good());
const template6 = _el$6;
var _el$7 = _tmpl$();
_$insert(_el$7, () => (state.count > 5 ? (state.dynamic ? best : good()) : bad));
const template7 = _el$7;
var _el$8 = _tmpl$();
_$insert(_el$8, () => state.dynamic && state.something && good());
const template8 = _el$8;
var _el$9 = _tmpl$();
_$insert(_el$9, () => (state.dynamic && good()) || bad);
const template9 = _el$9;
var _el$0 = _tmpl$();
_$insert(_el$0, () => (state.a ? "a" : state.b ? "b" : state.c ? "c" : "fallback"));
const template10 = _el$0;
var _el$1 = _tmpl$();
_$insert(_el$1, () => (state.a ? a() : state.b ? b() : state.c ? "c" : "fallback"));
const template11 = _el$1;
const template12 = _$createComponent(Comp, {
  get render() {
    return state.dynamic ? good() : bad;
  }
});

// no dynamic predicate
const template13 = _$createComponent(Comp, {
  get render() {
    return state.dynamic ? good : bad;
  }
});
const template14 = _$createComponent(Comp, {
  get render() {
    return state.dynamic && good();
  }
});

// no dynamic predicate
const template15 = _$createComponent(Comp, {
  get render() {
    return state.dynamic && good;
  }
});
const template16 = _$createComponent(Comp, {
  get render() {
    return state.dynamic || good();
  }
});
const template17 = _$createComponent(Comp, {
  get render() {
    return state.dynamic ? _$createComponent(Comp, {}) : _$createComponent(Comp, {});
  }
});
const template18 = _$createComponent(Comp, {
  get children() {
    return state.dynamic ? _$createComponent(Comp, {}) : _$createComponent(Comp, {});
  }
});
var _el$10 = _tmpl$();
_el$10.innerHTML = state.dynamic ? _$createComponent(Comp, {}) : _$createComponent(Comp, {});
const template19 = _el$10;
var _el$11 = _tmpl$();
_$insert(_el$11, () => (state.dynamic ? _$createComponent(Comp, {}) : _$createComponent(Comp, {})));
const template20 = _el$11;
const template21 = _$createComponent(Comp, {
  get render() {
    return state?.dynamic ? "a" : "b";
  }
});
const template22 = _$createComponent(Comp, {
  get children() {
    return state?.dynamic ? "a" : "b";
  }
});
var _el$12 = _tmpl$();
_el$12.innerHTML = state?.dynamic ? "a" : "b";
const template23 = _el$12;
var _el$13 = _tmpl$();
_$insert(_el$13, () => (state?.dynamic ? "a" : "b"));
const template24 = _el$13;
const template25 = _$createComponent(Comp, {
  get render() {
    return state.dynamic ?? _$createComponent(Comp, {});
  }
});
const template26 = _$createComponent(Comp, {
  get children() {
    return state.dynamic ?? _$createComponent(Comp, {});
  }
});
var _el$14 = _tmpl$();
_el$14.innerHTML = state.dynamic ?? _$createComponent(Comp, {});
const template27 = _el$14;
var _el$15 = _tmpl$();
_$insert(_el$15, () => state.dynamic ?? _$createComponent(Comp, {}));
const template28 = _el$15;
var _el$16 = _tmpl$();
_$insert(_el$16, () => (thing() && thing1()) ?? thing2() ?? thing3());
const template29 = _el$16;
var _el$17 = _tmpl$();
_$insert(_el$17, () => thing() || thing1() || thing2());
const template30 = _el$17;
const template31 = _$createComponent(Comp, {
  get value() {
    return count() ? (count() ? count() : count()) : count();
  }
});
var _el$18 = _tmpl$();
_$insert(_el$18, () => something?.());
const template32 = _el$18;
const template33 = _$createComponent(Comp, {
  get children() {
    return something?.();
  }
});
const template34 = simple ? good : bad;
const template35 = () => (simple ? good() : bad);
const template36 = () => (state.dynamic ? good() : bad);
const template37 = () => state.dynamic && good();
const template38 = () => (state.count > 5 ? (state.dynamic ? best : good()) : bad);
const template39 = () => state.dynamic && state.something && good();
const template40 = () => (state.dynamic && good()) || bad;
const template41 = () => (state.a ? "a" : state.b ? "b" : state.c ? "c" : "fallback");
const template42 = () => (state.a ? a() : state.b ? b() : state.c ? "c" : "fallback");
const template43 = () => (obj1.prop ? (obj2.prop ? _tmpl$2() : []) : []);

// statically boolean left: memo value IS the expression value, logical form kept
const template77 = () => state.count > 5 && good();
const template77a = () => !state.hidden && good.good;
