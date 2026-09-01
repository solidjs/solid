import { insert as _$insert } from "r-custom";
import { createComponent as _$createComponent } from "r-custom";
import { For as _$For } from "r-custom";
import { createElement as _$createElement } from "r-custom";
export function List({ items }) {
  var _el$ = _$createElement("list");
  _$insert(
    _el$,
    _$createComponent(_$For, {
      each: items,
      keyed: item => item.id,
      children: item =>
        (() => {
          var _el$2 = _$createElement("cell");
          _$insert(_el$2, () => item().label);
          return _el$2;
        })()
    })
  );
  return _el$;
}
