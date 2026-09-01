import { template as _$template } from "r-dom";
import { insert as _$insert } from "r-dom";
import { setAttribute as _$setAttribute } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(`<div><p></p><p>`),
  _tmpl$2 = /*#__PURE__*/ _$template(`<em>inner`);
export function Shadowed({ name, items }) {
  const format = name => `[${name}]`;
  const mapper = items.map(entry => {
    const name = entry.key;
    return name + format(name);
  });
  var _el$ = _tmpl$(),
    _el$2 = _el$.firstChild,
    _el$3 = _el$2.nextSibling;
  _$setAttribute(_el$, "title", name);
  _$insert(_el$2, name);
  _$insert(_el$3, () => mapper.join(","));
  _$insert(
    _el$,
    () => {
      let name = "inner";
      return _tmpl$2();
    },
    null
  );
  return _el$;
}
