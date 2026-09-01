import { template as _$template } from "r-dom";
import { insert as _$insert } from "r-dom";
import { setAttribute as _$setAttribute } from "r-dom";
import { createComponent as _$createComponent } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(`<section data-fixed=yes><p>`);
import { Input } from "./input.js";
export function Field({ value, onChange }) {
  return _$createComponent(Input, {
    value: value,
    onChange: onChange
  });
}
export function Host({ title }) {
  var _el$ = _tmpl$(),
    _el$2 = _el$.firstChild;
  _$setAttribute(_el$, "title", title);
  _$insert(_el$2, title);
  return _el$;
}
