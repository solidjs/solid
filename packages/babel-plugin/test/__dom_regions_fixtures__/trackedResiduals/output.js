import { template as _$template } from "r-dom";
import { className as _$className } from "r-dom";
import { region as _$region } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(`<tr><td> </td><td> `);
// The jfb row: a dynamic-key read of a FOREIGN store is a tracked residual
// in the compute; its DIRECT depth-1 subject read (row.id) rides the raw
// parameter (_u$) — the deep witness already wakes the compute. The classic
// fallback passes the proxy as _u$, keeping the same code per-key tracked.
function Row(row, selection) {
  var _el$ = _tmpl$(),
    _el$2 = _el$.firstChild,
    _el$3 = _el$2.firstChild,
    _el$4 = _el$2.nextSibling,
    _el$5 = _el$4.firstChild;
  _$region(
    row,
    (_t$, _u$) => {
      _t$.r0 = selection[_u$.id] ? "danger" : "";
    },
    (_n$, _t$, _p$) => {
      let _v$0 = _t$.r0;
      if (_v$0 !== _p$.e) {
        _$className(_el$, _v$0, _p$.e);
        _p$.e = _v$0;
      }
      let _v$1 = _n$.id;
      _v$1 !== _p$.t && (_el$3.data = _p$.t = _v$1);
      let _v$2 = _n$.label;
      _v$2 !== _p$.a && (_el$5.data = _p$.a = _v$2);
    }
  );
  return _el$;
}
