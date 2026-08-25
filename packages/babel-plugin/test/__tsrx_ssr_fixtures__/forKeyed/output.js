import { ssr as _$ssr } from "r-server";
import { escape as _$escape } from "r-server";
import { For as _$For } from "r-server";
var _tmpl$ = ["<ul>", "</ul>"],
  _tmpl$2 = "<li>No todos</li>",
  _tmpl$3 = ["<li>", ". ", "</li>"];
export function TodoList({ items }) {
  var _v$ = _$escape(
    _$For({
      each: items,
      keyed: item => item.id,
      get fallback() {
        return _$ssr(_tmpl$2);
      },
      children: (item, i) => {
        var _v$2, _v$3;
        return (
          (_v$2 = () => _$escape(i()) + 1),
          (_v$3 = () => _$escape(item().text)),
          _$ssr(_tmpl$3, _v$2, _v$3)
        );
      }
    })
  );
  return _$ssr(_tmpl$, _v$);
}
