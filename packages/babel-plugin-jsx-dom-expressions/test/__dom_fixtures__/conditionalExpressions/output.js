import { template as _$template } from "r-dom";
import { effect as _$effect } from "r-dom";
import { createComponent as _$createComponent } from "r-dom";
import { memo as _$memo } from "r-dom";
import { insert as _$insert } from "r-dom";

const _tmpl$ = _$template(`<div></div>`, 2);

const template1 = (() => {
  const _el$ = _tmpl$.cloneNode(true);

  _$insert(_el$, simple);

  return _el$;
})();

const template2 = (() => {
  const _el$2 = _tmpl$.cloneNode(true);

  _$insert(_el$2, () => state.dynamic);

  return _el$2;
})();

const template3 = (() => {
  const _el$3 = _tmpl$.cloneNode(true);

  _$insert(_el$3, simple ? good : bad);

  return _el$3;
})();

const template4 = (() => {
  const _el$4 = _tmpl$.cloneNode(true);

  _$insert(_el$4, () => (simple ? good() : bad));

  return _el$4;
})();

const template5 = (() => {
  const _el$5 = _tmpl$.cloneNode(true);

  _$insert(
    _el$5,
    (() => {
      const _c$ = _$memo(() => !!state.dynamic, true);

      return () => (_c$() ? good() : bad);
    })()
  );

  return _el$5;
})();

const template6 = (() => {
  const _el$6 = _tmpl$.cloneNode(true);

  _$insert(
    _el$6,
    (() => {
      const _c$2 = _$memo(() => !!state.dynamic, true);

      return () => _c$2() && good();
    })()
  );

  return _el$6;
})();

const template7 = (() => {
  const _el$7 = _tmpl$.cloneNode(true);

  _$insert(
    _el$7,
    (() => {
      const _c$3 = _$memo(() => state.count > 5, true);

      return () =>
        _c$3()
          ? (() => {
              const _c$4 = _$memo(() => !!state.dynamic, true);

              return () => (_c$4() ? best : good());
            })()
          : bad;
    })()
  );

  return _el$7;
})();

const template8 = (() => {
  const _el$8 = _tmpl$.cloneNode(true);

  _$insert(
    _el$8,
    (() => {
      const _c$5 = _$memo(() => !!(state.dynamic && state.something), true);

      return () => _c$5() && good();
    })()
  );

  return _el$8;
})();

const template9 = (() => {
  const _el$9 = _tmpl$.cloneNode(true);

  _$insert(
    _el$9,
    (() => {
      const _c$6 = _$memo(() => state.dynamic, true);

      return () => (_c$6() && good()) || bad;
    })()
  );

  return _el$9;
})();

const template10 = (() => {
  const _el$10 = _tmpl$.cloneNode(true);

  _$insert(_el$10, () => (state.a ? "a" : state.b ? "b" : state.c ? "c" : "fallback"));

  return _el$10;
})();

const template11 = (() => {
  const _el$11 = _tmpl$.cloneNode(true);

  _$insert(
    _el$11,
    (() => {
      const _c$7 = _$memo(() => !!state.a, true);

      return () =>
        _c$7()
          ? a()
          : (() => {
              const _c$8 = _$memo(() => !!state.b, true);

              return () => (_c$8() ? b() : state.c ? "c" : "fallback");
            })();
    })()
  );

  return _el$11;
})();

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

const template17 = (() => {
  const _c$12 = _$memo(() => !!state.dynamic, true);

  return _$createComponent(Comp, {
    get render() {
      return _c$12() ? _$createComponent(Comp, {}) : _$createComponent(Comp, {});
    }
  });
})();

const template18 = _$createComponent(Comp, {
  get children() {
    const _c$13 = _$memo(() => !!state.dynamic, true);

    return () => (_c$13() ? _$createComponent(Comp, {}) : _$createComponent(Comp, {}));
  }
});

const template19 = (() => {
  const _el$12 = _tmpl$.cloneNode(true);

  _$effect(
    () =>
      (_el$12.innerHTML = state.dynamic ? _$createComponent(Comp, {}) : _$createComponent(Comp, {}))
  );

  return _el$12;
})();

const template20 = (() => {
  const _el$13 = _tmpl$.cloneNode(true);

  _$insert(
    _el$13,
    (() => {
      const _c$14 = _$memo(() => !!state.dynamic, true);

      return () => (_c$14() ? _$createComponent(Comp, {}) : _$createComponent(Comp, {}));
    })()
  );

  return _el$13;
})();
