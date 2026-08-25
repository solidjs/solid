import { Match as _$Match } from "r-server";
import { Switch as _$Switch } from "r-server";
import { ssr as _$ssr } from "r-server";
import { Show as _$Show } from "r-server";
var _tmpl$ = "<span>On</span>",
  _tmpl$2 = "<span>Off</span>",
  _tmpl$3 = '<span class="badge active">Online</span>',
  _tmpl$4 = '<span class="badge idle">Away</span>',
  _tmpl$5 = '<span class="badge">Offline</span>';
export const Toggle = ({ on }) =>
  _$Show({
    when: on,
    get fallback() {
      return _$ssr(_tmpl$2);
    },
    get children() {
      return _$ssr(_tmpl$);
    }
  });
export const StatusBadge = ({ status }) =>
  _$Switch({
    get fallback() {
      return _$ssr(_tmpl$5);
    },
    get children() {
      return [
        _$Match({
          when: status === "active",
          get children() {
            return _$ssr(_tmpl$3);
          }
        }),
        _$Match({
          when: status === "idle",
          get children() {
            return _$ssr(_tmpl$4);
          }
        })
      ];
    }
  });
