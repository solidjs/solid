import { template as _$template } from "r-dom";
import { insert as _$insert } from "r-dom";
import { createComponent as _$createComponent } from "r-dom";
import { Show as _$Show } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(`<section class=preview>`),
  _tmpl$2 = /*#__PURE__*/ _$template(`<article><div></div><div></div><p></p><p></p><span>`),
  _tmpl$3 = /*#__PURE__*/ _$template(`<section>`),
  _tmpl$4 = /*#__PURE__*/ _$template(`<div><div></div><p>`);
export function Raw({ html, text }) {
  var _el$ = _tmpl$2(),
    _el$2 = _el$.firstChild,
    _el$3 = _el$2.nextSibling,
    _el$4 = _el$3.nextSibling,
    _el$5 = _el$4.nextSibling,
    _el$6 = _el$5.nextSibling;
  _el$2.innerHTML = html;
  _el$3.innerHTML = "<b>static markup</b>";
  _el$4.textContent = text;
  _el$5.textContent = "static text";
  _el$6.innerText = text;
  _$insert(
    _el$,
    _$createComponent(_$Show, {
      when: html,
      get fallback() {
        var _el$8 = _tmpl$3();
        _el$8.textContent = text;
        return _el$8;
      },
      get children() {
        var _el$7 = _tmpl$();
        _el$7.innerHTML = html;
        return _el$7;
      }
    }),
    null
  );
  return _el$;
}
export function NestedRaw({ html, text }) {
  var _el$9 = _tmpl$4(),
    _el$0 = _el$9.firstChild,
    _el$1 = _el$0.nextSibling;
  _el$0.innerHTML = html;
  _el$1.textContent = text;
  return _el$9;
}
