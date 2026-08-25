import { createTextNode as _$createTextNode } from "r-custom";
import { insertNode as _$insertNode } from "r-custom";
import { setProp as _$setProp } from "r-custom";
import { effect as _$effect } from "r-custom";
import { createComponent as _$createComponent } from "r-custom";
import { memo as _$memo } from "r-custom";
import { insert as _$insert } from "r-custom";
import { createElement as _$createElement } from "r-custom";
var _el$ = _$createElement("div");
_$insert(_el$, simple);
const template1 = _el$;
var _el$2 = _$createElement("div");
_$insert(_el$2, () => state.dynamic);
const template2 = _el$2;
var _el$3 = _$createElement("div");
_$insert(_el$3, simple ? good : bad);
const template3 = _el$3;
var _el$4 = _$createElement("div");
_$insert(_el$4, () => (simple ? good() : bad));
const template4 = _el$4;
var _el$5 = _$createElement("div");
_$insert(_el$5, () => (simple ? good.good : bad));
const template4a = _el$5;
var _el$6 = _$createElement("div");
_$insert(
  _el$6,
  (() => {
    var _c$ = _$memo(() => !!state.dynamic);
    return () => (_c$() ? good() : bad);
  })()
);
const template5 = _el$6;
var _el$7 = _$createElement("div");
_$insert(
  _el$7,
  (() => {
    var _c$2 = _$memo(() => !!state.dynamic);
    return () => (_c$2() ? good.good : bad);
  })()
);
const template5a = _el$7;
var _el$8 = _$createElement("div");
_$insert(
  _el$8,
  (() => {
    var _c$3 = _$memo(() => !!state.dynamic);
    return () => (_c$3() ? good() : state.dynamic);
  })()
);
const template6 = _el$8;
var _el$9 = _$createElement("div");
_$insert(
  _el$9,
  (() => {
    var _c$4 = _$memo(() => !!state.dynamic);
    return () => (_c$4() ? good.good : state.dynamic);
  })()
);
const template6a = _el$9;
var _el$0 = _$createElement("div");
_$insert(
  _el$0,
  (() => {
    var _c$5 = _$memo(() => state.count > 5);
    return () => (_c$5() ? (_$memo(() => !!state.dynamic)() ? best : good()) : bad);
  })()
);
const template7 = _el$0;
var _el$1 = _$createElement("div");
_$insert(
  _el$1,
  (() => {
    var _c$6 = _$memo(() => state.count > 5);
    return () => (_c$6() ? (_$memo(() => !!state.dynamic)() ? best : good.good) : bad);
  })()
);
const template7a = _el$1;
var _el$10 = _$createElement("div");
_$insert(
  _el$10,
  (() => {
    var _c$7 = _$memo(() => !!(state.dynamic && state.something));
    return () => (_c$7() ? good() : state.dynamic && state.something);
  })()
);
const template8 = _el$10;
var _el$11 = _$createElement("div");
_$insert(
  _el$11,
  (() => {
    var _c$8 = _$memo(() => !!(state.dynamic && state.something));
    return () => (_c$8() ? good.good : state.dynamic && state.something);
  })()
);
const template8a = _el$11;
var _el$12 = _$createElement("div");
_$insert(
  _el$12,
  (() => {
    var _c$9 = _$memo(() => !!state.dynamic);
    return () => (_c$9() ? good() : state.dynamic) || bad;
  })()
);
const template9 = _el$12;
var _el$13 = _$createElement("div");
_$insert(
  _el$13,
  (() => {
    var _c$0 = _$memo(() => !!state.dynamic);
    return () => (_c$0() ? good.good : state.dynamic) || bad;
  })()
);
const template9a = _el$13;
var _el$14 = _$createElement("div");
_$insert(
  _el$14,
  (() => {
    var _c$1 = _$memo(() => !!state.a);
    return () => (_c$1() ? "a" : _$memo(() => !!state.b)() ? "b" : state.c ? "c" : "fallback");
  })()
);
const template10 = _el$14;
var _el$15 = _$createElement("div");
_$insert(
  _el$15,
  (() => {
    var _c$10 = _$memo(() => !!state.a);
    return () => (_c$10() ? a() : _$memo(() => !!state.b)() ? b() : state.c ? "c" : "fallback");
  })()
);
const template11 = _el$15;
var _el$16 = _$createElement("div");
_$insert(
  _el$16,
  (() => {
    var _c$11 = _$memo(() => !!state.a);
    return () => (_c$11() ? a.a : _$memo(() => !!state.b)() ? b.b : state.c ? "c" : "fallback");
  })()
);
const template11a = _el$16;
const template12 = _$createComponent(Comp, {
  get render() {
    return _$memo(() => !!state.dynamic)() ? good() : bad;
  }
});
const template12a = _$createComponent(Comp, {
  get render() {
    return _$memo(() => !!state.dynamic)() ? good.good : bad;
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
    return _$memo(() => !!state.dynamic)() ? good() : state.dynamic;
  }
});
const template14a = _$createComponent(Comp, {
  get render() {
    return _$memo(() => !!state.dynamic)() ? good.good : state.dynamic;
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
const template16a = _$createComponent(Comp, {
  get render() {
    return state.dynamic || good.good;
  }
});
const template17 = _$createComponent(Comp, {
  get render() {
    return _$memo(() => !!state.dynamic)()
      ? _$createComponent(Comp, {})
      : _$createComponent(Comp, {});
  }
});
const template18 = _$createComponent(Comp, {
  get children() {
    return _$memo(() => !!state.dynamic)()
      ? _$createComponent(Comp, {})
      : _$createComponent(Comp, {});
  }
});
var _el$17 = _$createElement("div");
_$effect(
  () => (state.dynamic ? _$createComponent(Comp, {}) : _$createComponent(Comp, {})),
  (_v$, _$p) => {
    _$setProp(_el$17, "innerHTML", _v$, _$p);
  }
);
const template19 = _el$17;
var _el$18 = _$createElement("div");
_$insert(
  _el$18,
  (() => {
    var _c$12 = _$memo(() => !!state.dynamic);
    return () => (_c$12() ? _$createComponent(Comp, {}) : _$createComponent(Comp, {}));
  })()
);
const template20 = _el$18;
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
var _el$19 = _$createElement("div");
_$effect(
  () => (state?.dynamic ? "a" : "b"),
  (_v$, _$p) => {
    _$setProp(_el$19, "innerHTML", _v$, _$p);
  }
);
const template23 = _el$19;
var _el$20 = _$createElement("div");
_$insert(_el$20, () => (state?.dynamic ? "a" : "b"));
const template24 = _el$20;
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
var _el$21 = _$createElement("div");
_$effect(
  () => state.dynamic ?? _$createComponent(Comp, {}),
  (_v$, _$p) => {
    _$setProp(_el$21, "innerHTML", _v$, _$p);
  }
);
const template27 = _el$21;
var _el$22 = _$createElement("div");
_$insert(_el$22, () => state.dynamic ?? _$createComponent(Comp, {}));
const template28 = _el$22;
var _el$23 = _$createElement("div");
_$insert(
  _el$23,
  (() => {
    var _c$13 = _$memo(() => !!thing());
    return () => (_c$13() ? thing1() : thing()) ?? thing2() ?? thing3();
  })()
);
const template29 = _el$23;
var _el$24 = _$createElement("div");
_$insert(
  _el$24,
  (() => {
    var _c$14 = _$memo(() => !!thing.thing);
    return () => (_c$14() ? thing1.thing1 : thing.thing) ?? thing2.thing2 ?? thing3.thing3;
  })()
);
const template29a = _el$24;
var _el$25 = _$createElement("div");
_$insert(_el$25, () => thing() || thing1() || thing2());
const template30 = _el$25;
var _el$26 = _$createElement("div");
_$insert(_el$26, () => thing.thing || thing1.thing1 || thing2.thing2);
const template30a = _el$26;
const template31 = _$createComponent(Comp, {
  get value() {
    return _$memo(() => !!count())() ? (_$memo(() => !!count())() ? count() : count()) : count();
  }
});
const template31a = _$createComponent(Comp, {
  get value() {
    return _$memo(() => !!count.count)()
      ? _$memo(() => !!count.count)()
        ? count.count
        : count.count
      : count.count;
  }
});
var _el$27 = _$createElement("div");
_$insert(_el$27, () => something?.());
const template32 = _el$27;
const template33 = _$createComponent(Comp, {
  get children() {
    return something?.();
  }
});
const template34 = simple ? good : bad;
const template35 = _$memo(() => (simple ? good() : bad));
const template35a = _$memo(() => (simple ? good.good : bad));
const template36 = _$memo(() => (_$memo(() => !!state.dynamic)() ? good() : bad));
const template36a = _$memo(() => (_$memo(() => !!state.dynamic)() ? good.good : bad));
const template37 = _$memo(() => (_$memo(() => !!state.dynamic)() ? good() : state.dynamic));
const template37a = _$memo(() => (_$memo(() => !!state.dynamic)() ? good.good : state.dynamic));
const template38 = _$memo(() =>
  _$memo(() => state.count > 5)() ? (_$memo(() => !!state.dynamic)() ? best : good()) : bad
);
const template38a = _$memo(() =>
  _$memo(() => state.count > 5)() ? (_$memo(() => !!state.dynamic)() ? best : good.good) : bad
);
const template39 = _$memo(() =>
  _$memo(() => !!(state.dynamic && state.something))() ? good() : state.dynamic && state.something
);
const template39a = _$memo(() =>
  _$memo(() => !!(state.dynamic && state.something))()
    ? good.good
    : state.dynamic && state.something
);
const template40 = _$memo(() => (_$memo(() => !!state.dynamic)() ? good() : state.dynamic) || bad);
const template40a = _$memo(
  () => (_$memo(() => !!state.dynamic)() ? good.good : state.dynamic) || bad
);
const template41 = _$memo(() =>
  _$memo(() => !!state.a)() ? "a" : _$memo(() => !!state.b)() ? "b" : state.c ? "c" : "fallback"
);
const template42 = _$memo(() =>
  _$memo(() => !!state.a)() ? a() : _$memo(() => !!state.b)() ? b() : state.c ? "c" : "fallback"
);
const template42a = _$memo(() =>
  _$memo(() => !!state.a)() ? a.a : _$memo(() => !!state.b)() ? b.b : state.c ? "c" : "fallback"
);
const template43 = _$memo(() =>
  _$memo(() => !!obj1.prop)()
    ? _$memo(() => !!obj2.prop)()
      ? (() => {
          var _el$28 = _$createElement("div");
          _$insertNode(_el$28, _$createTextNode(`Output`));
          return _el$28;
        })()
      : []
    : []
);

// statically boolean left: memo value IS the expression value, logical form kept
const template77 = _$memo(() => _$memo(() => state.count > 5)() && good());
const template77a = _$memo(() => _$memo(() => !state.hidden)() && good.good);
