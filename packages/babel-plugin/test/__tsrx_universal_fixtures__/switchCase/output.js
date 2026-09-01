import { insert as _$insert } from "r-custom";
import { createComponent as _$createComponent } from "r-custom";
import { createTextNode as _$createTextNode } from "r-custom";
import { insertNode as _$insertNode } from "r-custom";
import { createElement as _$createElement } from "r-custom";
import { Match as _$Match } from "r-custom";
import { Switch as _$Switch } from "r-custom";
export const StatusMessage = ({ status }) =>
  _$createComponent(_$Switch, {
    get fallback() {
      var _el$5 = _$createElement("p");
      _$insertNode(_el$5, _$createTextNode(`Unknown status.`));
      return _el$5;
    },
    get children() {
      return [
        _$createComponent(_$Match, {
          when: status === "loading",
          get children() {
            var _el$ = _$createElement("p");
            _$insertNode(_el$, _$createTextNode(`Loading...`));
            return _el$;
          }
        }),
        _$createComponent(_$Match, {
          when: status === "success",
          get children() {
            var _el$3 = _$createElement("p", {
              class: "success"
            });
            _$insertNode(_el$3, _$createTextNode(`Done!`));
            return _el$3;
          }
        })
      ];
    }
  });
export function NoDefault({ mode }) {
  var _el$7 = _$createElement("header");
  _$insert(
    _el$7,
    _$createComponent(_$Switch, {
      get children() {
        return [
          _$createComponent(_$Match, {
            get when() {
              return mode.kind === "wide";
            },
            get children() {
              var _el$8 = _$createElement("h1");
              _$insertNode(_el$8, _$createTextNode(`Wide`));
              return _el$8;
            }
          }),
          _$createComponent(_$Match, {
            get when() {
              return mode.kind === "narrow";
            },
            get children() {
              var _el$0 = _$createElement("h2");
              _$insertNode(_el$0, _$createTextNode(`Narrow`));
              return _el$0;
            }
          })
        ];
      }
    })
  );
  return _el$7;
}
