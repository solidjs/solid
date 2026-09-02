import { template as _$template } from "r-dom";
import { style as _$style } from "r-dom";
import { className as _$className } from "r-dom";
import { region as _$region } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(`<tr><td> `);
// class/style consume the previous VALUE — the baseline advances in a block
// after the write instead of inline in the setter argument.
function Row(row) {
  var _el$ = _tmpl$(),
    _el$2 = _el$.firstChild,
    _el$3 = _el$2.firstChild;
  _$region(row, null, (_n$, _t$, _p$) => {
    let _v$0 = _n$.selected ? "danger" : "";
    if (_v$0 !== _p$.e) {
      _$className(_el$, _v$0, _p$.e);
      _p$.e = _v$0;
    }
    let _v$1 = _n$.style;
    if (_v$1 !== _p$.t) {
      _$style(_el$, _v$1, _p$.t);
      _p$.t = _v$1;
    }
    let _v$2 = _n$.label;
    _v$2 !== _p$.a && (_el$3.data = _p$.a = _v$2);
  });
  return _el$;
}
