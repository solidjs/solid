import { createComponent as _$createComponent } from "r-server";
import { ssr as _$ssr } from "r-server";
import { escape as _$escape } from "r-server";

const template1 = _$ssr(["<div>", "</div>"], _$escape(simple));

const template2 = _$ssr(["<div>", "</div>"], _$escape(state.dynamic));

const template3 = _$ssr(["<div>", "</div>"], simple ? _$escape(good) : _$escape(bad));

const template4 = _$ssr(["<div>", "</div>"], simple ? _$escape(good()) : _$escape(bad));

const template5 = _$ssr(["<div>", "</div>"], state.dynamic ? _$escape(good()) : _$escape(bad));

const template6 = _$ssr(["<div>", "</div>"], state.dynamic && _$escape(good()));

const template7 = _$ssr(
  ["<div>", "</div>"],
  state.count > 5 ? (state.dynamic ? _$escape(best) : _$escape(good())) : _$escape(bad)
);

const template8 = _$ssr(["<div>", "</div>"], state.dynamic && state.something && _$escape(good()));

const template9 = _$ssr(["<div>", "</div>"], (state.dynamic && _$escape(good())) || _$escape(bad));

const template10 = _$ssr(
  ["<div>", "</div>"],
  state.a ? "a" : state.b ? "b" : state.c ? "c" : "fallback"
);

const template11 = _$ssr(
  ["<div>", "</div>"],
  state.a ? _$escape(a()) : state.b ? _$escape(b()) : state.c ? "c" : "fallback"
);

const template12 = _$createComponent(Comp, {
  get render() {
    return state.dynamic ? good() : bad;
  }
}); // no dynamic predicate

const template13 = _$createComponent(Comp, {
  get render() {
    return state.dynamic ? good : bad;
  }
});

const template14 = _$createComponent(Comp, {
  get render() {
    return state.dynamic && good();
  }
}); // no dynamic predicate

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
