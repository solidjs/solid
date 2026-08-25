import { memo as _$memo } from "r-server";
import { ssr as _$ssr } from "r-server";
import { escape as _$escape } from "r-server";
var _tmpl$ = ["<div>", "</div>"],
  _tmpl$2 = "<div>Output</div>",
  _tmpl$3 = "<span>s</span>",
  _tmpl$4 = "<span>a</span>",
  _tmpl$5 = "<span>b</span>";
var _v$ = _$escape(simple);
const template1 = _$ssr(_tmpl$, _v$);
var _v$2 = () => _$escape(state.dynamic);
const template2 = _$ssr(_tmpl$, _v$2);
var _v$3 = simple ? _$escape(good) : _$escape(bad);
const template3 = _$ssr(_tmpl$, _v$3);
var _v$4 = () => (simple ? _$escape(good()) : _$escape(bad));
const template4 = _$ssr(_tmpl$, _v$4);
var _v$5 = () => (simple ? _$escape(good.good) : _$escape(bad));
const template4a = _$ssr(_tmpl$, _v$5);
var _v$6 = (() => {
  var _c$ = _$memo(() => !!state.dynamic);
  return () => (_c$() ? _$escape(good()) : _$escape(bad));
})();
const template5 = _$ssr(_tmpl$, _v$6);
var _v$7 = (() => {
  var _c$2 = _$memo(() => !!state.dynamic);
  return () => (_c$2() ? _$escape(good.good) : _$escape(bad));
})();
const template5a = _$ssr(_tmpl$, _v$7);
var _v$8 = (() => {
  var _c$3 = _$memo(() => !!state.dynamic);
  return () => (_c$3() ? _$escape(good()) : _$escape(state.dynamic));
})();
const template6 = _$ssr(_tmpl$, _v$8);
var _v$9 = (() => {
  var _c$4 = _$memo(() => !!state.dynamic);
  return () => (_c$4() ? _$escape(good.good) : _$escape(state.dynamic));
})();
const template6a = _$ssr(_tmpl$, _v$9);
var _v$0 = (() => {
  var _c$5 = _$memo(() => state.count > 5);
  return () =>
    _c$5() ? (_$memo(() => !!state.dynamic)() ? _$escape(best) : _$escape(good())) : _$escape(bad);
})();
const template7 = _$ssr(_tmpl$, _v$0);
var _v$1 = (() => {
  var _c$6 = _$memo(() => state.count > 5);
  return () =>
    _c$6()
      ? _$memo(() => !!state.dynamic)()
        ? _$escape(best)
        : _$escape(good.good)
      : _$escape(bad);
})();
const template7a = _$ssr(_tmpl$, _v$1);
var _v$10 = (() => {
  var _c$7 = _$memo(() => !!(state.dynamic && state.something));
  return () => (_c$7() ? _$escape(good()) : state.dynamic && _$escape(state.something));
})();
const template8 = _$ssr(_tmpl$, _v$10);
var _v$11 = (() => {
  var _c$8 = _$memo(() => !!(state.dynamic && state.something));
  return () => (_c$8() ? _$escape(good.good) : state.dynamic && _$escape(state.something));
})();
const template8a = _$ssr(_tmpl$, _v$11);
var _v$12 = (() => {
  var _c$9 = _$memo(() => !!state.dynamic);
  return () => _$escape((_c$9() ? good() : state.dynamic) || bad);
})();
const template9 = _$ssr(_tmpl$, _v$12);
var _v$13 = (() => {
  var _c$0 = _$memo(() => !!state.dynamic);
  return () => _$escape((_c$0() ? good.good : state.dynamic) || bad);
})();
const template9a = _$ssr(_tmpl$, _v$13);
var _v$14 = (() => {
  var _c$1 = _$memo(() => !!state.a);
  return () => (_c$1() ? "a" : _$memo(() => !!state.b)() ? "b" : state.c ? "c" : "fallback");
})();
const template10 = _$ssr(_tmpl$, _v$14);
var _v$15 = (() => {
  var _c$10 = _$memo(() => !!state.a);
  return () =>
    _c$10()
      ? _$escape(a())
      : _$memo(() => !!state.b)()
        ? _$escape(b())
        : state.c
          ? "c"
          : "fallback";
})();
const template11 = _$ssr(_tmpl$, _v$15);
var _v$16 = (() => {
  var _c$11 = _$memo(() => !!state.a);
  return () =>
    _c$11()
      ? _$escape(a.a)
      : _$memo(() => !!state.b)()
        ? _$escape(b.b)
        : state.c
          ? "c"
          : "fallback";
})();
const template11a = _$ssr(_tmpl$, _v$16);
const template12 = Comp({
  get render() {
    return _$memo(() => !!state.dynamic)() ? good() : bad;
  }
});
const template12a = Comp({
  get render() {
    return _$memo(() => !!state.dynamic)() ? good.good : bad;
  }
});

// no dynamic predicate
const template13 = Comp({
  get render() {
    return state.dynamic ? good : bad;
  }
});
const template14 = Comp({
  get render() {
    return _$memo(() => !!state.dynamic)() ? good() : state.dynamic;
  }
});
const template14a = Comp({
  get render() {
    return _$memo(() => !!state.dynamic)() ? good.good : state.dynamic;
  }
});

// no dynamic predicate
const template15 = Comp({
  get render() {
    return state.dynamic && good;
  }
});
const template16 = Comp({
  get render() {
    return state.dynamic || good();
  }
});
const template16a = Comp({
  get render() {
    return state.dynamic || good.good;
  }
});
const template17 = Comp({
  get render() {
    return _$memo(() => !!state.dynamic)() ? Comp({}) : Comp({});
  }
});
const template18 = Comp({
  get children() {
    return _$memo(() => !!state.dynamic)() ? Comp({}) : Comp({});
  }
});
var _v$17 = (() => {
  var _c$12 = _$memo(() => !!state.dynamic);
  return () => (_c$12() ? Comp({}) : Comp({}));
})();
const template19 = _$ssr(_tmpl$, _v$17);
var _v$18 = (() => {
  var _c$13 = _$memo(() => !!state.dynamic);
  return () => (_c$13() ? _$escape(Comp({})) : _$escape(Comp({})));
})();
const template20 = _$ssr(_tmpl$, _v$18);
const template21 = Comp({
  get render() {
    return state?.dynamic ? "a" : "b";
  }
});
const template22 = Comp({
  get children() {
    return state?.dynamic ? "a" : "b";
  }
});
var _v$19 = () => (state?.dynamic ? "a" : "b");
const template23 = _$ssr(_tmpl$, _v$19);
var _v$20 = () => (state?.dynamic ? "a" : "b");
const template24 = _$ssr(_tmpl$, _v$20);
const template25 = Comp({
  get render() {
    return state.dynamic ?? Comp({});
  }
});
const template26 = Comp({
  get children() {
    return state.dynamic ?? Comp({});
  }
});
var _v$21 = () => state.dynamic ?? Comp({});
const template27 = _$ssr(_tmpl$, _v$21);
var _v$22 = () => _$escape(state.dynamic ?? Comp({}));
const template28 = _$ssr(_tmpl$, _v$22);
var _v$23 = (() => {
  var _c$14 = _$memo(() => !!thing());
  return () => _$escape((_c$14() ? thing1() : thing()) ?? thing2() ?? thing3());
})();
const template29 = _$ssr(_tmpl$, _v$23);
var _v$24 = (() => {
  var _c$15 = _$memo(() => !!thing.thing);
  return () => _$escape((_c$15() ? thing1.thing1 : thing.thing) ?? thing2.thing2 ?? thing3.thing3);
})();
const template29a = _$ssr(_tmpl$, _v$24);
var _v$25 = () => _$escape(thing() || thing1() || thing2());
const template30 = _$ssr(_tmpl$, _v$25);
var _v$26 = () => _$escape(thing.thing || thing1.thing1 || thing2.thing2);
const template30a = _$ssr(_tmpl$, _v$26);
const template31 = Comp({
  get value() {
    return _$memo(() => !!count())() ? (_$memo(() => !!count())() ? count() : count()) : count();
  }
});
const template31a = Comp({
  get value() {
    return _$memo(() => !!count.count)()
      ? _$memo(() => !!count.count)()
        ? count.count
        : count.count
      : count.count;
  }
});
var _v$27 = () => _$escape(something?.());
const template32 = _$ssr(_tmpl$, _v$27);
var _v$28 = () => _$escape(something?.something);
const template32a = _$ssr(_tmpl$, _v$28);
const template33 = Comp({
  get children() {
    return something?.();
  }
});
const template33a = Comp({
  get children() {
    return something?.something;
  }
});
const template34 = simple ? good : bad;
const template35 = _$memo(() => _$escape(simple ? good() : bad));
const template35a = _$memo(() => _$escape(simple ? good.good : bad));
const template36 = _$memo(() => _$escape(_$memo(() => !!state.dynamic)() ? good() : bad));
const template36a = _$memo(() => _$escape(_$memo(() => !!state.dynamic)() ? good.good : bad));
const template37 = _$memo(() => _$escape(_$memo(() => !!state.dynamic)() ? good() : state.dynamic));
const template37a = _$memo(() =>
  _$escape(_$memo(() => !!state.dynamic)() ? good.good : state.dynamic)
);
const template38 = _$memo(() =>
  _$escape(
    _$memo(() => state.count > 5)() ? (_$memo(() => !!state.dynamic)() ? best : good()) : bad
  )
);
const template38a = _$memo(() =>
  _$escape(
    _$memo(() => state.count > 5)() ? (_$memo(() => !!state.dynamic)() ? best : good.good) : bad.bad
  )
);
const template39 = _$memo(() =>
  _$escape(
    _$memo(() => !!(state.dynamic && state.something))() ? good() : state.dynamic && state.something
  )
);
const template40 = _$memo(() =>
  _$escape((_$memo(() => !!state.dynamic)() ? good() : state.dynamic) || bad)
);
const template40a = _$memo(() =>
  _$escape((_$memo(() => !!state.dynamic)() ? good.good : state.dynamic) || bad)
);
const template41 = _$memo(() =>
  _$escape(
    _$memo(() => !!state.a)() ? "a" : _$memo(() => !!state.b)() ? "b" : state.c ? "c" : "fallback"
  )
);
const template42 = _$memo(() =>
  _$escape(
    _$memo(() => !!state.a)() ? a() : _$memo(() => !!state.b)() ? b() : state.c ? "c" : "fallback"
  )
);
const template42a = _$memo(() =>
  _$escape(
    _$memo(() => !!state.a)() ? a.a : _$memo(() => !!state.b)() ? b.b : state.c ? "c" : "fallback"
  )
);
const template43 = _$memo(() =>
  _$escape(_$memo(() => !!obj1.prop)() ? (_$memo(() => !!obj2.prop)() ? _$ssr(_tmpl$2) : []) : [])
);

// single-significant-child fragment in element slot — outer _$escape wrap
// is skipped because the fragment compiles to a self-escaping form.
var _v$29 = cond && _$memo(() => _$escape(state.text));
const template44 = _$ssr(_tmpl$, _v$29);
var _v$30 = cond ? _$memo(() => _$escape(state.a)) : _$memo(() => _$escape(state.b));
const template45 = _$ssr(_tmpl$, _v$30);
var _v$31 = cond && _$ssr(_tmpl$3);
const template46 = _$ssr(_tmpl$, _v$31);
var _v$32 = cond ? _$ssr(_tmpl$4) : _$ssr(_tmpl$5);
const template47 = _$ssr(_tmpl$, _v$32);

// component inside fragment must keep the outer _$escape wrap because a
// component call can return any runtime type, including a raw string.
var _v$33 = cond && _$escape(Comp({}));
const template48 = _$ssr(_tmpl$, _v$33);

// mixed fragment content keeps the outer wrap — predicate is conservative
// and only skips when exactly one significant child is provably safe.
var _v$34 = cond && _$escape(["hello ", _$memo(() => _$escape(state.text))]);
const template49 = _$ssr(_tmpl$, _v$34);

// statically boolean left: memo value IS the expression value, logical form kept
const template77 = _$memo(() => _$escape(_$memo(() => state.count > 5)() && good()));
const template77a = _$memo(() => _$escape(_$memo(() => !state.hidden)() && good.good));
