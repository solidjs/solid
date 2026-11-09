import { ssr as _$ssr } from "r-server";
import { escape as _$escape } from "r-server";
var _tmpl$ = [
    "<article><div>",
    "</div><div><b>static markup</b></div><p>",
    "</p><p>static text</p>",
    "</article>"
  ],
  _tmpl$2 = ['<section class="preview">', "</section>"],
  _tmpl$3 = ["<section>", "</section>"];
export function Raw({ html, text }) {
  var _v$4, _v$5;
  var _v$ = html,
    _v$2 = _$escape(text),
    _v$3 = html
      ? ((_v$4 = html), _$ssr(_tmpl$2, _v$4))
      : ((_v$5 = _$escape(text)), _$ssr(_tmpl$3, _v$5));
  return _$ssr(_tmpl$, _v$, _v$2, _v$3);
}
