import { Show as _$Show } from "r-server";
import { ssr as _$ssr } from "r-server";
import { escape as _$escape } from "r-server";
import { For as _$For } from "r-server";
var _tmpl$ = ["<table><tbody>", "</tbody></table>"],
  _tmpl$2 = ['<td class="dense">', "</td>"],
  _tmpl$3 = ["<tr>", "</tr>"],
  _tmpl$4 = "<td>empty row</td>",
  _tmpl$5 = ["<td>", ": ", "</td>"];
var _m$ = Symbol();
var _d$ = {
    get() {
      const row = this[_m$];
      return row().cells;
    },
    enumerable: true,
    configurable: true
  },
  _d$2 = {
    get() {
      return _$ssr(_tmpl$4);
    },
    enumerable: true,
    configurable: true
  };
function _P$(_p, _p2, _p3) {
  this[_m$] = _p;
  Object.defineProperty(this, "each", _d$);
  this.keyed = _p2;
  Object.defineProperty(this, "fallback", _d$2);
  this.children = _p3;
}
_P$.prototype = Object.prototype;
var _d$3 = {
    get() {
      const row = this[_m$];
      return _$For(
        new _P$(row, false, (cell, c) => {
          var _v$4, _v$5;
          return (
            (_v$4 = _$escape(c)),
            (_v$5 = () => _$escape(cell())),
            _$ssr(_tmpl$5, _v$4, _v$5)
          );
        })
      );
    },
    enumerable: true,
    configurable: true
  },
  _d$4 = {
    get() {
      const row = this[_m$];
      var _v$2;
      return ((_v$2 = () => _$escape(row().cells.length)), _$ssr(_tmpl$2, _v$2));
    },
    enumerable: true,
    configurable: true
  };
function _P$2(_p4, _p5) {
  this[_m$] = _p4;
  this.when = _p5;
  Object.defineProperty(this, "fallback", _d$3);
  Object.defineProperty(this, "children", _d$4);
}
_P$2.prototype = Object.prototype;
export function Grid({ rows, dense }) {
  var _v$ = _$escape(
    _$For({
      each: rows,
      keyed: row => row.id,
      children: row => {
        var _v$3;
        return ((_v$3 = _$escape(_$Show(new _P$2(row, dense)))), _$ssr(_tmpl$3, _v$3));
      }
    })
  );
  return _$ssr(_tmpl$, _v$);
}
