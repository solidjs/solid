import { template as _$template } from "r-dom";
import { insert as _$insert } from "r-dom";
import { createComponent as _$createComponent } from "r-dom";
import { For as _$For } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(`<ul>`),
  _tmpl$2 = /*#__PURE__*/ _$template(`<li>No todos`),
  _tmpl$3 = /*#__PURE__*/ _$template(`<li>. <!>`),
  _tmpl$4 = /*#__PURE__*/ _$template(`<ol>`),
  _tmpl$5 = /*#__PURE__*/ _$template(`<li><h3></h3><p>#`);
export function TodoList({ items }) {
  var _el$ = _tmpl$();
  _$insert(
    _el$,
    _$createComponent(_$For, {
      get each() {
        return items.filter(item => !item.hidden);
      },
      keyed: item => item.id,
      get fallback() {
        return _tmpl$2();
      },
      children: (item, i) =>
        (() => {
          var _el$3 = _tmpl$3(),
            _el$4 = _el$3.firstChild,
            _el$5 = _el$4.nextSibling;
          _$insert(_el$3, () => i() + 1, _el$4);
          _$insert(_el$3, () => item().text, _el$5);
          return _el$3;
        })()
    })
  );
  return _el$;
}
export function WithSetup({ posts }) {
  var _el$6 = _tmpl$4();
  _$insert(
    _el$6,
    _$createComponent(_$For, {
      each: posts,
      children: (post, n) => {
        const heading = post.title.trim();
        var _el$7 = _tmpl$5(),
          _el$8 = _el$7.firstChild,
          _el$9 = _el$8.nextSibling,
          _el$0 = _el$9.firstChild;
        _$insert(_el$8, heading);
        _$insert(_el$9, n, null);
        return _el$7;
      }
    })
  );
  return _el$6;
}
