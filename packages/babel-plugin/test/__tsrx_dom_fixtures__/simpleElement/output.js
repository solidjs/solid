import { template as _$template } from "r-dom";
import { insert as _$insert } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(`<div class=card><p>`),
  _tmpl$2 = /*#__PURE__*/ _$template(`<svg aria-hidden=true>`);
export function Greeting({ name }) {
  const message = name ? `Hello, ${name}` : "Hello, stranger";
  var _el$ = _tmpl$(),
    _el$2 = _el$.firstChild;
  _$insert(_el$2, message);
  return _el$;
}
const icon = _tmpl$2();
