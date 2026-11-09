import { template as _$template } from "r-dom";
import { memo as _$memo } from "r-dom";
import { insert as _$insert } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(`<section><h2>`),
  _tmpl$2 = /*#__PURE__*/ _$template(`<span class=pill>Admin`);
interface User {
  name: string;
  role: "admin" | "member";
}
export function Profile({ user }: { user: User }) {
  const label: string = user.name.toUpperCase();
  var _el$ = _tmpl$(),
    _el$2 = _el$.firstChild;
  _$insert(_el$2, label);
  _$insert(
    _el$,
    (() => {
      var _c$ = _$memo(() => user.role === "admin");
      return () => (_c$() ? _tmpl$2() : void 0);
    })(),
    null
  );
  return _el$;
}
