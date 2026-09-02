import { template as _$template } from "r-dom";
import { className as _$className } from "r-dom";
import { region as _$region } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(`<tr><td class=dbname> </td><td> </td><td> </td><td> `);
// The dbmon row: static-key chains below the subject's own keys are
// eligible and set the DEEP flag (writes bubble to the region root — no
// witness subscriptions).
function Row(db) {
  var _el$ = _tmpl$(),
    _el$2 = _el$.firstChild,
    _el$3 = _el$2.firstChild,
    _el$4 = _el$2.nextSibling,
    _el$5 = _el$4.firstChild,
    _el$6 = _el$4.nextSibling,
    _el$7 = _el$6.firstChild,
    _el$8 = _el$6.nextSibling,
    _el$9 = _el$8.firstChild;
  _$region(
    db,
    null,
    (_n$, _t$, _p$) => {
      let _v$0 = _n$.name;
      _v$0 !== _p$.e && (_el$3.data = _p$.e = _v$0);
      let _v$1 = _n$.countClass;
      if (_v$1 !== _p$.t) {
        _$className(_el$4, _v$1, _p$.t);
        _p$.t = _v$1;
      }
      let _v$2 = _n$.count;
      _v$2 !== _p$.a && (_el$5.data = _p$.a = _v$2);
      let _v$3 = _n$.queries[0].className;
      if (_v$3 !== _p$.o) {
        _$className(_el$6, _v$3, _p$.o);
        _p$.o = _v$3;
      }
      let _v$4 = _n$.queries[0].elapsed;
      _v$4 !== _p$.i && (_el$7.data = _p$.i = _v$4);
      let _v$5 = _n$.queries[1].className;
      if (_v$5 !== _p$.n) {
        _$className(_el$8, _v$5, _p$.n);
        _p$.n = _v$5;
      }
      let _v$6 = _n$.queries[1].elapsed;
      _v$6 !== _p$.s && (_el$9.data = _p$.s = _v$6);
    },
    1
  );
  return _el$;
}
