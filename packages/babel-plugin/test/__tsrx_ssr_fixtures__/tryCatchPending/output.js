import { ssr as _$ssr } from "r-server";
import { escape as _$escape } from "r-server";
import { Loading as _$Loading } from "r-server";
import { Errored as _$Errored } from "r-server";
var _tmpl$ = ["<div><p>Error: ", "</p><button>Try again</button></div>"],
  _tmpl$2 = "<p>Loading...</p>";
var _d$ = {
    get() {
      return _$ssr(_tmpl$2);
    },
    enumerable: true,
    configurable: true
  },
  _d$2 = {
    get() {
      return Profile({
        id: 1
      });
    },
    enumerable: true,
    configurable: true
  };
function _P$() {
  Object.defineProperty(this, "fallback", _d$);
  Object.defineProperty(this, "children", _d$2);
}
_P$.prototype = Object.prototype;
var _d$3 = {
  get() {
    return _$Loading(new _P$());
  },
  enumerable: true,
  configurable: true
};
function _P$2(_p) {
  this.fallback = _p;
  Object.defineProperty(this, "children", _d$3);
}
_P$2.prototype = Object.prototype;
import { Profile } from "./profile.js";
export const App = () =>
  _$Errored(
    new _P$2((e, reset) => {
      var _v$;
      return ((_v$ = () => _$escape(e().message)), _$ssr(_tmpl$, _v$));
    })
  );
