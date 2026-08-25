import { template as _$template } from "r-dom";
import { createComponent as _$createComponent } from "r-dom";
import { Show as _$Show } from "r-dom";
import { insert as _$insert } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(`<span class=pill>Admin`),
  _tmpl$2 = /*#__PURE__*/ _$template(`<section><h2>`);
interface User {
  name: string;
  role: "admin" | "member";
}
export function Profile({ user }: { user: User }) {
  const label: string = user.name.toUpperCase();
  var _el$ = _tmpl$2(),
    _el$2 = _el$.firstChild;
  _$insert(_el$2, label);
  _$insert(
    _el$,
    _$createComponent(_$Show, {
      get when() {
        return user.role === "admin";
      },
      get children() {
        return _tmpl$();
      }
    }),
    null
  );
  return _el$;
}
