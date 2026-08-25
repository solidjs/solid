import { template as _$template } from "r-dom";
import { setAttribute as _$setAttribute } from "r-dom";
import { effect as _$effect } from "r-dom";
import { insert as _$insert } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(`<div><p></p><p>`),
  _tmpl$2 = /*#__PURE__*/ _$template(`<em>inner`);
export function Shadowed(__lazy0) {
  const format = name => `[${name}]`;
  const mapper = __lazy0.items.map(entry => {
    const name = entry.key;
    return name + format(name);
  });
  var _el$ = _tmpl$(),
    _el$2 = _el$.firstChild,
    _el$3 = _el$2.nextSibling;
  _$insert(_el$2, () => __lazy0.name);
  _$insert(_el$3, () => mapper.join(","));
  _$insert(
    _el$,
    () => {
      let name = "inner";
      return _tmpl$2();
    },
    null
  );
  _$effect(
    () => __lazy0.name,
    _v$ => {
      _$setAttribute(_el$, "title", _v$);
    }
  );
  return _el$;
}
