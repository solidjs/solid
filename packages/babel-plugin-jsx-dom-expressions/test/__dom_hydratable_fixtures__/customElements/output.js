import { template as _$template } from "r-dom";
import { effect as _$effect } from "r-dom";
import { getNextElement as _$getNextElement } from "r-dom";
import { currentContext as _$currentContext } from "r-dom";
import { setAttribute as _$setAttribute } from "r-dom";

const _tmpl$ = _$template(`<my-element></my-element>`, 2),
  _tmpl$2 = _$template(`<my-element><header slot="head">Title</header></my-element>`, 4),
  _tmpl$3 = _$template(`<slot name="head"></slot>`, 2);

const template = (() => {
  const _el$ = _$getNextElement(_tmpl$);

  _el$.someAttr = name;
  _el$.notprop = data;

  _$setAttribute(_el$, "my-attr", data);

  _el$.someProp = data;
  _el$._context = _$currentContext();
  return _el$;
})();

const template2 = (() => {
  const _el$2 = _$getNextElement(_tmpl$);

  _el$2._context = _$currentContext();

  _$effect(
    _p$ => {
      const _v$ = state.name,
        _v$2 = state.data,
        _v$3 = state.data,
        _v$4 = state.data;
      _v$ !== _p$._v$ && (_el$2.someAttr = _p$._v$ = _v$);
      _v$2 !== _p$._v$2 && (_el$2.notprop = _p$._v$2 = _v$2);
      _v$3 !== _p$._v$3 && _$setAttribute(_el$2, "my-attr", (_p$._v$3 = _v$3));
      _v$4 !== _p$._v$4 && (_el$2.someProp = _p$._v$4 = _v$4);
      return _p$;
    },
    {
      _v$: undefined,
      _v$2: undefined,
      _v$3: undefined,
      _v$4: undefined
    }
  );

  return _el$2;
})();

const template3 = (() => {
  const _el$3 = _$getNextElement(_tmpl$2);

  _el$3._context = _$currentContext();
  return _el$3;
})();

const template4 = (() => {
  const _el$4 = _$getNextElement(_tmpl$3);

  _el$4._context = _$currentContext();
  return _el$4;
})();
