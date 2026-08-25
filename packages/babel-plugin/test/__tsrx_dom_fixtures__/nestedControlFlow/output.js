import { template as _$template } from "r-dom";
import { Show as _$Show } from "r-dom";
import { insert as _$insert } from "r-dom";
import { createComponent as _$createComponent } from "r-dom";
import { For as _$For } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(`<table><tbody>`),
  _tmpl$2 = /*#__PURE__*/ _$template(`<td class=dense>`),
  _tmpl$3 = /*#__PURE__*/ _$template(`<tr>`),
  _tmpl$4 = /*#__PURE__*/ _$template(`<td>empty row`),
  _tmpl$5 = /*#__PURE__*/ _$template(`<td>: <!>`);
export function Grid({ rows, dense }) {
  var _el$ = _tmpl$(),
    _el$2 = _el$.firstChild;
  _$insert(
    _el$2,
    _$createComponent(_$For, {
      each: rows,
      keyed: row => row.id,
      children: row =>
        (() => {
          var _el$3 = _tmpl$3();
          _$insert(
            _el$3,
            _$createComponent(_$Show, {
              when: dense,
              get fallback() {
                return _$createComponent(_$For, {
                  get each() {
                    return row().cells;
                  },
                  get fallback() {
                    return _tmpl$4();
                  },
                  children: (cell, c) =>
                    (() => {
                      var _el$6 = _tmpl$5(),
                        _el$7 = _el$6.firstChild,
                        _el$8 = _el$7.nextSibling;
                      _$insert(_el$6, c, _el$7);
                      _$insert(_el$6, cell, _el$8);
                      return _el$6;
                    })()
                });
              },
              get children() {
                var _el$4 = _tmpl$2();
                _$insert(_el$4, () => row().cells.length);
                return _el$4;
              }
            })
          );
          return _el$3;
        })()
    })
  );
  return _el$;
}
