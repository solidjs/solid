import { template as _$template } from "r-dom";
import { memo as _$memo } from "r-dom";
import { insert as _$insert } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(`<h1>`),
  _tmpl$2 = /*#__PURE__*/ _$template(`<p> — read in <!> minutes`),
  _tmpl$3 = /*#__PURE__*/ _$template(`<hr>`),
  _tmpl$4 = /*#__PURE__*/ _$template(`<mark>Draft`);
export function Article({ post }) {
  return [
    (() => {
      var _el$ = _tmpl$();
      _$insert(_el$, () => post.title);
      return _el$;
    })(),
    (() => {
      var _el$2 = _tmpl$2(),
        _el$3 = _el$2.firstChild,
        _el$5 = _el$3.nextSibling;
      _$insert(_el$2, () => post.summary, _el$3);
      _$insert(_el$2, () => post.minutes, _el$5);
      return _el$2;
    })(),
    _$memo(() => (_$memo(() => !!post.draft)() ? _tmpl$4() : void 0)),
    _tmpl$3()
  ];
}
