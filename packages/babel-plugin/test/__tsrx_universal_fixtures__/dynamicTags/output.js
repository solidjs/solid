import { createComponent as _$createComponent } from "r-custom";
import { insert as _$insert } from "r-custom";
import { createElement as _$createElement } from "r-custom";
import { Dynamic as _$Dynamic } from "r-custom";
export function Panel({ as, title }) {
  return _$createComponent(_$Dynamic, {
    component: as,
    kind: "panel",
    get children() {
      var _el$ = _$createElement("label");
      _$insert(_el$, title);
      return _el$;
    }
  });
}
