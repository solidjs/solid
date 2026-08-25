import { template as _$template } from "r-dom";
import { insert as _$insert } from "r-dom";
import { createComponent as _$createComponent } from "r-dom";
import { For as _$For } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(`<ul>`),
  _tmpl$2 = /*#__PURE__*/ _$template(`<li>`),
  _tmpl$3 = /*#__PURE__*/ _$template(`<tbody>`),
  _tmpl$4 = /*#__PURE__*/ _$template(`<tr><td></td><td>`);
export function List({ items }) {
  var _el$ = _tmpl$();
  _$insert(
    _el$,
    _$createComponent(_$For, {
      each: items,
      children: item =>
        (() => {
          var _el$2 = _tmpl$2();
          _$insert(_el$2, item);
          return _el$2;
        })()
    })
  );
  return _el$;
}
export const Rows = ({ rows }) =>
  (() => {
    var _el$3 = _tmpl$3();
    _$insert(
      _el$3,
      _$createComponent(_$For, {
        each: rows,
        children: ({ id, label }) =>
          (() => {
            var _el$4 = _tmpl$4(),
              _el$5 = _el$4.firstChild,
              _el$6 = _el$5.nextSibling;
            _$insert(_el$5, id);
            _$insert(_el$6, label);
            return _el$4;
          })()
      })
    );
    return _el$3;
  })();
