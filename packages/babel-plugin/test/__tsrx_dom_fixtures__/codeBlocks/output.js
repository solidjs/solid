import { template as _$template } from "r-dom";
import { insert as _$insert } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(`<span>`),
  _tmpl$2 = /*#__PURE__*/ _$template(`<section><h1>`),
  _tmpl$3 = /*#__PURE__*/ _$template(`<footer>`),
  _tmpl$4 = /*#__PURE__*/ _$template(`<span>static`);
export function App({ name }) {
  const title = (() => {
    const label = name.trim();
    var _el$ = _tmpl$();
    _$insert(_el$, label);
    return _el$;
  })();
  var _el$2 = _tmpl$2(),
    _el$3 = _el$2.firstChild;
  _$insert(_el$3, title);
  _$insert(
    _el$2,
    () => {
      const footer = name.toUpperCase();
      var _el$4 = _tmpl$3();
      _$insert(_el$4, footer);
      return _el$4;
    },
    null
  );
  return _el$2;
}
const nativeTemplate = (() => {
  const label = "static";
  return _tmpl$4();
})();
