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
export function Raw({ html, text }) {
  var _v$3;
  var _v$ = html,
    _v$2 = _$escape(text),
    _v$4 = _$escape(
      _$Show({
        when: html,
        get fallback() {
          var _v$5 = _$escape(text);
          return _$ssr(_tmpl$3, _v$5);
        },
        get children() {
          return ((_v$3 = html), _$ssr(_tmpl$, _v$3));
        }
      })
    );
  return _$ssr(_tmpl$2, _v$, _v$2, _v$4);
}
