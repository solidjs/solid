import { template as _$template } from "r-dom";
import { delegateEvents as _$delegateEvents } from "r-dom";
import { setAttribute as _$setAttribute } from "r-dom";
import { effect as _$effect } from "r-dom";
import { insert as _$insert } from "r-dom";
import { createComponent as _$createComponent } from "r-dom";
import { For as _$For } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(`<ul>`),
  _tmpl$2 = /*#__PURE__*/ _$template(`<li> / <!>`);
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
          _el$4 = _el$3.nextSibling;
        _el$2._$$click = () => preserve("local", 0);
        _$insert(_el$2, () => row().name, _el$3);
        _$insert(_el$2, index, _el$4);
        _$effect(
          () => ({
            e: snapshot.name,
            t: index()
          }),
          ({ e, t }, _p$) => {
            e !== _p$?.e && _$setAttribute(_el$2, "data-row", e);
            t !== _p$?.t && _$setAttribute(_el$2, "data-index", t);
          }
        );
        return _el$2;
      }
    })
  );
  return _el$;
}
_$delegateEvents(["click"]);
