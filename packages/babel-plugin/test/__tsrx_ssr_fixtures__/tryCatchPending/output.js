import { ssr as _$ssr } from "r-server";
import { escape as _$escape } from "r-server";
import { Loading as _$Loading } from "r-server";
import { Errored as _$Errored } from "r-server";
var _tmpl$ = ["<div><p>Error: ", "</p><button>Try again</button></div>"],
  _tmpl$2 = "<p>Loading...</p>";
import { Profile } from "./profile.js";
export const App = () =>
  _$Errored({
    fallback: (e, reset) => {
      var _v$;
      return ((_v$ = () => _$escape(e().message)), _$ssr(_tmpl$, _v$));
    },
    get children() {
      return _$Loading({
        get fallback() {
          return _$ssr(_tmpl$2);
        },
        get children() {
          return Profile({
            id: 1
          });
        }
      });
    }
  });
