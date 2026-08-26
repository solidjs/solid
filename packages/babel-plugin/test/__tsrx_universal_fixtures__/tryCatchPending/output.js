import { insert as _$insert } from "r-custom";
import { createTextNode as _$createTextNode } from "r-custom";
import { insertNode as _$insertNode } from "r-custom";
import { createElement as _$createElement } from "r-custom";
import { createComponent as _$createComponent } from "r-custom";
import { Loading as _$Loading } from "r-custom";
import { Errored as _$Errored } from "r-custom";
import { Profile } from "./profile.js";
export const App = () =>
  _$createComponent(_$Errored, {
    fallback: (e, reset) =>
      (() => {
        var _el$ = _$createElement("div"),
          _el$2 = _$createElement("p"),
          _el$3 = _$createTextNode(`Error: `),
          _el$4 = _$createElement("button", {
            onClick: () => reset()
          });
        _$insertNode(_el$, _el$2);
        _$insertNode(_el$, _el$4);
        _$insertNode(_el$2, _el$3);
        _$insert(_el$2, () => e().message, null);
        _$insertNode(_el$4, _$createTextNode(`Try again`));
        return _el$;
      })(),
    get children() {
      return _$createComponent(_$Loading, {
        get fallback() {
          var _el$6 = _$createElement("p");
          _$insertNode(_el$6, _$createTextNode(`Loading...`));
          return _el$6;
        },
        get children() {
          return _$createComponent(Profile, {
            id: 1
          });
        }
      });
    }
  });
export const PendingOnly = () =>
  _$createComponent(_$Loading, {
    get fallback() {
      var _el$8 = _$createElement("p");
      _$insertNode(_el$8, _$createTextNode(`Loading...`));
      return _el$8;
    },
    get children() {
      return _$createComponent(Profile, {
        id: 2
      });
    }
  });
export const CatchOnly = () =>
  _$createComponent(_$Errored, {
    fallback: err =>
      (() => {
        var _el$0 = _$createElement("p"),
          _el$1 = _$createTextNode(`: `);
        _$insertNode(_el$0, _el$1);
        _$insert(_el$0, () => err().name, _el$1);
        _$insert(_el$0, () => String(err()), null);
        return _el$0;
      })(),
    get children() {
      return _$createComponent(Profile, {
        id: 3
      });
    }
  });
