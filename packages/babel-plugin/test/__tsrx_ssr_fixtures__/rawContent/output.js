import { ssr as _$ssr } from "r-server";
import { Show as _$Show } from "r-server";
import { escape as _$escape } from "r-server";
var _tmpl$ = ['<section class="preview">', "</section>"],
  _tmpl$2 = [
    "<article><div>",
    "</div><div><b>static markup</b></div><p>",
    "</p><p>static text</p>",
    "</article>"
  ],
  _tmpl$3 = ["<section>", "</section>"];
var _m$ = Symbol(),
  _m$2 = Symbol();
var _d$ = {
    get() {
      const text = this[_m$];
      var _v$5 = _$escape(text);
      return _$ssr(_tmpl$3, _v$5);
    },
    enumerable: true,
    configurable: true
  },
  _d$2 = {
    get() {
      const html = this[_m$2];
      var _v$3;
      return ((_v$3 = html), _$ssr(_tmpl$, _v$3));
    },
    enumerable: true,
    configurable: true
  };
function _P$(_p, _p2, _p3) {
  this[_m$] = _p;
  this[_m$2] = _p2;
  this.when = _p3;
  Object.defineProperty(this, "fallback", _d$);
  Object.defineProperty(this, "children", _d$2);
}
_P$.prototype = Object.prototype;
export function Raw({ html, text }) {
  var _v$ = html,
    _v$2 = _$escape(text),
    _v$4 = _$escape(_$Show(new _P$(text, html, html)));
  return _$ssr(_tmpl$2, _v$, _v$2, _v$4);
}
