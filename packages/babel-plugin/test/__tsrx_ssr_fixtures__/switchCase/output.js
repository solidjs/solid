import { ssr as _$ssr } from "r-server";
import { Match as _$Match } from "r-server";
import { Switch as _$Switch } from "r-server";
var _tmpl$ = "<p>Loading...</p>",
  _tmpl$2 = '<p class="success">Done!</p>',
  _tmpl$3 = "<p>Unknown status.</p>";
export const StatusMessage = ({ status }) =>
  _$Switch({
    get fallback() {
      return _$ssr(_tmpl$3);
    },
    get children() {
      return [
        _$Match({
          when: status === "loading",
          get children() {
            return _$ssr(_tmpl$);
          }
        }),
        _$Match({
          when: status === "success",
          get children() {
            return _$ssr(_tmpl$2);
          }
        })
      ];
    }
  });
