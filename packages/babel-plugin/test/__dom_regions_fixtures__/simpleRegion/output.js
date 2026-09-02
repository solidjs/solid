import { template as _$template } from "r-dom";
import { setAttribute as _$setAttribute } from "r-dom";
import { region as _$region } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(`<tr><td> </td><td> </td><td></td><td>`);
// Depth-1 subject: every binding is a static member read of one constant
// record — the whole scope rides one region with raw commit reads.
function Row(row) {
  var _el$ = _tmpl$(),
    _el$2 = _el$.firstChild,
    _el$3 = _el$2.firstChild,
    _el$4 = _el$2.nextSibling,
    _el$5 = _el$4.firstChild,
    _el$6 = _el$4.nextSibling,
    _el$7 = _el$6.nextSibling;
  _$region(
    row,
    (_t$, _u$, _d$) => {
      _t$.e = _u$.id;
      _t$.t = _u$.label;
      _t$.a = _u$.done ? "done" : "pending";
      _t$.o = _u$["foo--bar"];
    },
    (_t$, _p$, _f$) => {
      let _v$0 = _t$.e;
      (_f$ || _v$0 !== _p$.e) && ((_el$3.data = _v$0), (_p$.e = _v$0));
      let _v$1 = _t$.t;
      (_f$ || _v$1 !== _p$.t) && ((_el$5.data = _v$1), (_p$.t = _v$1));
      let _v$2 = _t$.a;
      (_f$ || _v$2 !== _p$.a) && (_$setAttribute(_el$6, "data-status", _v$2), (_p$.a = _v$2));
      let _v$3 = _t$.o;
      (_f$ || _v$3 !== _p$.o) && (_$setAttribute(_el$7, "data-css", _v$3), (_p$.o = _v$3));
    }
  );
  return _el$;
}
