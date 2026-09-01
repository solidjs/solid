import { ssr as _$ssr } from "r-server";
import { ssrAttribute as _$ssrAttribute } from "r-server";
import { escape as _$escape } from "r-server";
var _tmpl$ = ["<button", ">", ": ", "</button>"];
export function LazyScope({ model }) {
  let __lazy0 = model;
  const outer = () => __lazy0.count;
  const inner = count => count + 1;
  const snapshot = {
    count: __lazy0.count,
    label: __lazy0.label
  };
  const update = () => {
    __lazy0.count += 1;
    __lazy0.count++;
    ++__lazy0.count;
    __lazy0.count = inner(__lazy0.count);
  };
  var _v$ = () => _$ssrAttribute("data-count", _$escape(snapshot.count, true)),
    _v$2 = () => _$escape(__lazy0.label),
    _v$3 = () => _$escape(outer());
  return _$ssr(_tmpl$, _v$, _v$2, _v$3);
}
