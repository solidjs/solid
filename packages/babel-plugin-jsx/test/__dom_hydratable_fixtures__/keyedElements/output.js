import { template as _$template } from "r-dom";
import { createComponent as _$createComponent } from "r-dom";
import { className as _$className } from "r-dom";
import { effect as _$effect } from "r-dom";
import { insert as _$insert } from "r-dom";
import { getNextElement as _$getNextElement } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(`<ul><li>Apple`),
  _tmpl$2 = /*#__PURE__*/ _$template(`<ul><li>`);
// `$key` is server markup identity (SSR-only): a DOM compile strips it from
// intrinsic elements — client-owned DOM is never morph-managed, and a
// literal `$key` attribute is never intended output. On a component, `$key`
// is slot occurrence identity — a prop the runtime owns — so it must pass
// through unrenamed.
const staticKey = _$getNextElement(_tmpl$);
var _el$2 = _$getNextElement(_tmpl$2),
  _el$3 = _el$2.firstChild;
_$insert(_el$3, () => item.text);
_$effect(
  () => item.cls,
  (_v$, _$p) => {
    _$className(_el$3, _v$, _$p);
  }
);
const dynamicKey = _el$2;
const componentKey = _$createComponent(Row, {
  get $key() {
    return item.id;
  },
  get text() {
    return item.text;
  }
});
