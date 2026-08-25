import { ssr as _$ssr } from "r-server";
import { escape as _$escape } from "r-server";
var _tmpl$ = ["<div><h2>", "</h2><p>Age: ", "</p></div>"],
  _tmpl$2 = ["<button>Count: ", "</button>"];
import { createSignal } from "solid-js";
export function UserCard(__lazy0) {
  var _v$ = () => _$escape(__lazy0.name),
    _v$2 = () => _$escape(__lazy0.age);
  return _$ssr(_tmpl$, _v$, _v$2);
}
export function Counter() {
  let __lazy1 = createSignal(0);
  var _v$3 = () => _$escape(__lazy1[0]);
  return _$ssr(_tmpl$2, _v$3);
}
