import { ssr as _$ssr } from "r-server";
import { Match as _$Match } from "r-server";
import { Switch as _$Switch } from "r-server";
var _tmpl$ = "<p>Loading...</p>",
  _tmpl$2 = '<p class="success">Done!</p>',
  _tmpl$3 = "<p>Unknown status.</p>";
var _m$ = Symbol();
var _d$ = {
  get() {
    return _$ssr(_tmpl$);
  },
  enumerable: true,
  configurable: true
};
function _P$(_p) {
  this.when = _p;
  Object.defineProperty(this, "children", _d$);
}
_P$.prototype = Object.prototype;
var _d$2 = {
  get() {
    return _$ssr(_tmpl$2);
  },
  enumerable: true,
  configurable: true
};
function _P$2(_p2) {
  this.when = _p2;
  Object.defineProperty(this, "children", _d$2);
}
_P$2.prototype = Object.prototype;
var _d$3 = {
    get() {
      return _$ssr(_tmpl$3);
    },
    enumerable: true,
    configurable: true
  },
  _d$4 = {
    get() {
      const status = this[_m$];
      return [_$Match(new _P$(status === "loading")), _$Match(new _P$2(status === "success"))];
    },
    enumerable: true,
    configurable: true
  };
function _P$3(_p3) {
  this[_m$] = _p3;
  Object.defineProperty(this, "fallback", _d$3);
  Object.defineProperty(this, "children", _d$4);
}
_P$3.prototype = Object.prototype;
export const StatusMessage = ({ status }) => _$Switch(new _P$3(status));
