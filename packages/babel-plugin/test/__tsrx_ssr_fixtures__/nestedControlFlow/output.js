import { ssr as _$ssr } from "r-server";
import { escape as _$escape } from "r-server";
import { For as _$For } from "r-server";
var _tmpl$ = ["<table><tbody>", "</tbody></table>"],
  _tmpl$2 = ["<tr>", "</tr>"],
  _tmpl$3 = ['<td class="dense">', "</td>"],
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
export function Grid({ rows, dense }) {
  var _v$ = _$escape(
    _$For({
      each: rows,
      keyed: row => row.id,
      children: row => {
        var _v$2, _v$3;
        return (
          (_v$2 = dense
            ? ((_v$3 = () => _$escape(row().cells.length)), _$ssr(_tmpl$3, _v$3))
            : _$escape(
                _$For(
                  new _P$(row, false, (cell, c) => {
                    var _v$4, _v$5;
                    return (
                      (_v$4 = _$escape(c)),
                      (_v$5 = () => _$escape(cell())),
                      _$ssr(_tmpl$5, _v$4, _v$5)
                    );
                  })
                )
              )),
          _$ssr(_tmpl$2, _v$2)
        );
      }
    })
  );
  return _$ssr(_tmpl$, _v$);
}
