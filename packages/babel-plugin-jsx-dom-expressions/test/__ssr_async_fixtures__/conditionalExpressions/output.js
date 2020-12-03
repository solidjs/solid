import { createComponent as _$createComponent } from "r-server";
import { memo as _$memo } from "r-server";
import { ssr as _$ssr } from "r-server";
import { escape as _$escape } from "r-server";

const template1 = _$ssr(["<div>", "</div>"], _$escape(simple));

const template2 = _$ssr(["<div>", "</div>"], () => _$escape(state.dynamic));

const template3 = _$ssr(["<div>", "</div>"], simple ? _$escape(good) : _$escape(bad));

const template4 = _$ssr(["<div>", "</div>"], () => (simple ? _$escape(good()) : _$escape(bad)));

const template5 = _$ssr(
  ["<div>", "</div>"],
  (() => {
    const _c$ = _$memo(() => !!state.dynamic, true);

    return () => (_c$() ? _$escape(good()) : _$escape(bad));
  })()
);

const template6 = _$ssr(
  ["<div>", "</div>"],
  (() => {
    const _c$2 = _$memo(() => !!state.dynamic, true);

    return () => _c$2() && _$escape(good());
  })()
);

const template7 = _$ssr(
  ["<div>", "</div>"],
  (() => {
    const _c$3 = _$memo(() => state.count > 5, true);

    return () =>
      _c$3()
        ? (() => {
            const _c$4 = _$memo(() => !!state.dynamic, true);

            return () => (_c$4() ? _$escape(best) : _$escape(good()));
          })()
        : _$escape(bad);
  })()
);

const template8 = _$ssr(
  ["<div>", "</div>"],
  (() => {
    const _c$5 = _$memo(() => !!(state.dynamic && state.something), true);

    return () => _c$5() && _$escape(good());
  })()
);

const template9 = _$ssr(
  ["<div>", "</div>"],
  (() => {
    const _c$6 = _$memo(() => state.dynamic, true);

    return () => (_c$6() && _$escape(good())) || _$escape(bad);
  })()
);

const template10 = _$ssr(["<div>", "</div>"], () =>
  state.a ? "a" : state.b ? "b" : state.c ? "c" : "fallback"
);

const template11 = _$ssr(
  ["<div>", "</div>"],
  (() => {
    const _c$7 = _$memo(() => !!state.a, true);

    return () =>
      _c$7()
        ? _$escape(a())
        : (() => {
            const _c$8 = _$memo(() => !!state.b, true);

            return () => (_c$8() ? _$escape(b()) : state.c ? "c" : "fallback");
          })();
  })()
);

const template12 = (() => {
  const _c$9 = _$memo(() => !!state.dynamic, true);

  return _$createComponent(Comp, {
    get render() {
      return _c$9() ? good() : bad;
    }
  });
})(); // no dynamic predicate

const template13 = _$createComponent(Comp, {
  get render() {
    return state.dynamic ? good : bad;
  }
});

const template14 = (() => {
  const _c$10 = _$memo(() => !!state.dynamic, true);

  return _$createComponent(Comp, {
    get render() {
      return _c$10() && good();
    }
  });
})(); // no dynamic predicate

const template15 = _$createComponent(Comp, {
  get render() {
    return state.dynamic && good;
  }
});

const template16 = (() => {
  const _c$11 = _$memo(() => state.dynamic, true);

  return _$createComponent(Comp, {
    get render() {
      return _c$11() || good();
    }
  });
})();
