import { Match as _$Match } from "r-server";
import { Switch as _$Switch } from "r-server";
import { ssr as _$ssr } from "r-server";
import { Show as _$Show } from "r-server";
var _tmpl$ = "<span>On</span>",
  _tmpl$2 = "<span>Off</span>",
  _tmpl$3 = '<span class="badge active">Online</span>',
  _tmpl$4 = '<span class="badge idle">Away</span>',
  _tmpl$5 = '<span class="badge">Offline</span>';
var _m$ = Symbol();
var _d$ = {
    get() {
      return _$ssr(_tmpl$2);
    },
    enumerable: true,
    configurable: true
  },
  _d$2 = {
    get() {
      return _$ssr(_tmpl$);
    },
    enumerable: true,
    configurable: true
  };
function _P$(_p) {
  this.when = _p;
  Object.defineProperty(this, "fallback", _d$);
  Object.defineProperty(this, "children", _d$2);
}
_P$.prototype = Object.prototype;
var _d$3 = {
  get() {
    return _$ssr(_tmpl$3);
  },
  enumerable: true,
  configurable: true
};
function _P$2(_p2) {
  this.when = _p2;
  Object.defineProperty(this, "children", _d$3);
}
_P$2.prototype = Object.prototype;
var _d$4 = {
  get() {
    return _$ssr(_tmpl$4);
  },
  enumerable: true,
  configurable: true
};
function _P$3(_p3) {
  this.when = _p3;
  Object.defineProperty(this, "children", _d$4);
}
_P$3.prototype = Object.prototype;
var _d$5 = {
    get() {
      return _$ssr(_tmpl$5);
    },
    enumerable: true,
    configurable: true
  },
  _d$6 = {
    get() {
      const status = this[_m$];
      return [_$Match(new _P$2(status === "active")), _$Match(new _P$3(status === "idle"))];
    },
    enumerable: true,
    configurable: true
  };
function _P$4(_p4) {
  this[_m$] = _p4;
  Object.defineProperty(this, "fallback", _d$5);
  Object.defineProperty(this, "children", _d$6);
}
_P$4.prototype = Object.prototype;
export const Toggle = ({ on }) => _$Show(new _P$(on));
export const StatusBadge = ({ status }) => _$Switch(new _P$4(status));
