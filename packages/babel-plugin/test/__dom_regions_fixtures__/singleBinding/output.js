import { template as _$template } from "r-dom";
import { region as _$region } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(`<td> `);
// A single eligible binding still regionizes (no grouped-effect special
// case: one body, one baseline slot).
function Cell(row) {
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
