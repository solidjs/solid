import { template as _$template } from "r-dom";
import { effect as _$effect } from "r-dom";
import { region as _$region } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(`<td> `);
// Region and classic scopes coexist in one module: both wrappers import.
function RegionRow(row) {
  var _el$ = _tmpl$(),
    _el$2 = _el$.firstChild;
  _$region(
    row,
    (_t$, _u$, _d$) => {
      _t$.e = _u$.label;
    },
    (_t$, _p$, _f$) => {
      let _v$0 = _t$.e;
      (_f$ || _v$0 !== _p$.e) && ((_el$2.data = _v$0), (_p$.e = _v$0));
    }
  );
  return _el$;
}
function ClassicRow(get) {
  var _el$3 = _tmpl$(),
    _el$4 = _el$3.firstChild;
  _$effect(
    () => get(),
    _v$ => {
      _el$4.data = _v$;
    }
  );
  return _el$3;
}
