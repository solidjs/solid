import { createTextNode as _$createTextNode } from "r-custom";
import { insertNode as _$insertNode } from "r-custom";
import { createElement as _$createElement } from "r-custom";
export const Toggle = ({ on }) =>
  on
    ? (() => {
        var _el$ = _$createElement("view");
        _$insertNode(_el$, _$createTextNode(`On`));
        return _el$;
      })()
    : (() => {
        var _el$3 = _$createElement("view");
        _$insertNode(_el$3, _$createTextNode(`Off`));
        return _el$3;
      })();
