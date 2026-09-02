import { template as _$template } from "r-dom";
import { setAttribute as _$setAttribute } from "r-dom";
import { region as _$region } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(`<tr><td> </td><td> </td><td>`);
// Depth-1 subject: every binding is a static member read of one constant
// record — the whole scope rides one region with raw commit reads.
function Row(row) {
  var _el$ = _tmpl$(),
    _el$2 = _el$.firstChild,
    _el$3 = _el$2.firstChild,
    _el$4 = _el$2.nextSibling,
    _el$5 = _el$4.firstChild,
    _el$6 = _el$4.nextSibling;
  _$region(row, null, (_n$, _t$, _p$) => {
    let _v$0 = _n$.id;
    _v$0 !== _p$.e && (_el$3.data = _p$.e = _v$0);
    let _v$1 = _n$.label;
    _v$1 !== _p$.t && (_el$5.data = _p$.t = _v$1);
    let _v$2 = _n$.done ? "done" : "pending";
    _v$2 !== _p$.a && _$setAttribute(_el$6, "data-status", (_p$.a = _v$2));
  });
  return _el$;
}
