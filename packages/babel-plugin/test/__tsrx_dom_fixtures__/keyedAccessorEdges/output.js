import { template as _$template } from "r-dom";
import { delegateEvents as _$delegateEvents } from "r-dom";
import { effect as _$effect } from "r-dom";
import { setAttribute as _$setAttribute } from "r-dom";
import { insert as _$insert } from "r-dom";
import { createComponent as _$createComponent } from "r-dom";
import { For as _$For } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(`<ul>`),
  _tmpl$2 = /*#__PURE__*/ _$template(`<li> / <!> / <!> / <!> / <!>`);
export function Rows({ rows }) {
  var _el$ = _tmpl$();
  _$insert(
    _el$,
    _$createComponent(_$For, {
      each: rows,
      keyed: row => row.id,
      children: (row, index) => {
        const snapshot = row();
        const preserve = (row, index) => row + index;
        var _el$2 = _tmpl$2(),
          _el$3 = _el$2.firstChild,
          _el$7 = _el$3.nextSibling,
          _el$4 = _el$7.nextSibling,
          _el$8 = _el$4.nextSibling,
          _el$5 = _el$8.nextSibling,
          _el$9 = _el$5.nextSibling,
          _el$6 = _el$9.nextSibling,
          _el$0 = _el$6.nextSibling;
        _el$2.$$click = () => preserve("local", 0);
        _$setAttribute(_el$2, "data-row", snapshot);
        _$insert(_el$2, row, _el$3);
        _$insert(_el$2, () => row().name, _el$7);
        _$insert(_el$2, () => row()(), _el$8);
        _$insert(_el$2, index, _el$9);
        _$insert(_el$2, () => index()(), _el$0);
        _$effect(
          () => index(),
          _v$ => {
            _$setAttribute(_el$2, "data-index", _v$);
          }
        );
        return _el$2;
      }
    })
  );
  return _el$;
}
_$delegateEvents(["click"]);
