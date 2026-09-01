import { Show as _$Show } from "r-server";
import { ssr as _$ssr } from "r-server";
import { escape as _$escape } from "r-server";
import { For as _$For } from "r-server";
var _tmpl$ = ["<table><tbody>", "</tbody></table>"],
  _tmpl$2 = ['<td class="dense">', "</td>"],
  _tmpl$3 = ["<tr>", "</tr>"],
  _tmpl$4 = "<td>empty row</td>",
  _tmpl$5 = ["<td>", ": ", "</td>"];
export function Grid({ rows, dense }) {
  var _v$ = _$escape(
    _$For({
      each: rows,
      keyed: row => row.id,
      children: row => {
        var _v$2, _v$3;
        return (
          (_v$3 = _$escape(
            _$Show({
              when: dense,
              get fallback() {
                return _$For({
                  get each() {
                    return row().cells;
                  },
                  keyed: false,
                  get fallback() {
                    return _$ssr(_tmpl$4);
                  },
                  children: (cell, c) => {
                    var _v$4, _v$5;
                    return (
                      (_v$4 = _$escape(c)),
                      (_v$5 = () => _$escape(cell())),
                      _$ssr(_tmpl$5, _v$4, _v$5)
                    );
                  }
                });
              },
              get children() {
                return ((_v$2 = () => _$escape(row().cells.length)), _$ssr(_tmpl$2, _v$2));
              }
            })
          )),
          _$ssr(_tmpl$3, _v$3)
        );
      }
    })
  );
  return _$ssr(_tmpl$, _v$);
}
