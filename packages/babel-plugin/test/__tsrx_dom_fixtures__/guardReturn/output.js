import { template as _$template } from "r-dom";
import { insert as _$insert } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(`<p>Access revoked`),
  _tmpl$2 = /*#__PURE__*/ _$template(`<main><h1>Welcome back, `);
export function Dashboard({ user }) {
  if (!user) {
    return null;
  }
  if (user.banned) {
    return _tmpl$();
  }
  var _el$2 = _tmpl$2(),
    _el$3 = _el$2.firstChild,
    _el$4 = _el$3.firstChild;
  _$insert(_el$3, () => user.name, null);
  return _el$2;
}
