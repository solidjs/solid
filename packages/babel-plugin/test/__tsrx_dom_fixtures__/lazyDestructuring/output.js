import { template as _$template } from "r-dom";
import { delegateEvents as _$delegateEvents } from "r-dom";
import { insert as _$insert } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(`<span>`),
  _tmpl$2 = /*#__PURE__*/ _$template(`<div><h2></h2><p>Age: `),
  _tmpl$3 = /*#__PURE__*/ _$template(`<button>Count: `),
  _tmpl$4 = /*#__PURE__*/ _$template(`<address> / <!>`);
import { createSignal } from "solid-js";
let __lazy0 = createSignal("light");
export function ThemeLabel() {
  var _el$ = _tmpl$();
  _el$.$$click = () => __lazy0[1]("dark");
  _$insert(_el$, () => __lazy0[0]);
  return _el$;
}
export function UserCard(__lazy1) {
  var _el$2 = _tmpl$2(),
    _el$3 = _el$2.firstChild,
    _el$4 = _el$3.nextSibling,
    _el$5 = _el$4.firstChild;
  _$insert(_el$3, () => __lazy1.name);
  _$insert(_el$4, () => __lazy1.age, null);
  return _el$2;
}
export function Counter() {
  let __lazy2 = createSignal(0);
  var _el$6 = _tmpl$3(),
    _el$7 = _el$6.firstChild;
  _el$6.$$click = () => __lazy2[1](__lazy2[0]() + 1);
  _$insert(_el$6, () => __lazy2[0], null);
  return _el$6;
}
export function FromObject({ user }) {
  const __lazy3 = user;
  var _el$8 = _tmpl$4(),
    _el$9 = _el$8.firstChild,
    _el$0 = _el$9.nextSibling;
  _$insert(_el$8, () => __lazy3.name, _el$9);
  _$insert(_el$8, () => __lazy3.address.city, _el$0);
  return _el$8;
}
_$delegateEvents(["click"]);
