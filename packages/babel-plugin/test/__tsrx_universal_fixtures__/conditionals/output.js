import { createComponent as _$createComponent } from "r-custom";
import { createTextNode as _$createTextNode } from "r-custom";
import { insertNode as _$insertNode } from "r-custom";
import { createElement as _$createElement } from "r-custom";
import { Show as _$Show } from "r-custom";
export const Toggle = ({ on }) =>
  _$createComponent(_$Show, {
    when: on,
    get fallback() {
      var _el$3 = _$createElement("view");
      _$insertNode(_el$3, _$createTextNode(`Off`));
      return _el$3;
    },
    get children() {
      var _el$ = _$createElement("view");
      _$insertNode(_el$, _$createTextNode(`On`));
      return _el$;
    }
  });
