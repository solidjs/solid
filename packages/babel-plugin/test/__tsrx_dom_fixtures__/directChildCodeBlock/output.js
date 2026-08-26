import { template as _$template } from "r-dom";
import { insert as _$insert } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(`<section>before<!>after`),
  _tmpl$2 = /*#__PURE__*/ _$template(`<strong>`);
export function DirectChild({ name }) {
  var _el$ = _tmpl$(),
    _el$2 = _el$.firstChild,
    _el$4 = _el$2.nextSibling,
    _el$3 = _el$4.nextSibling;
  _$insert(
    _el$,
    () => {
      const greeting = name.trim();
      var _el$5 = _tmpl$2();
      _$insert(_el$5, greeting);
      return _el$5;
    },
    _el$4
  );
  return _el$;
}
