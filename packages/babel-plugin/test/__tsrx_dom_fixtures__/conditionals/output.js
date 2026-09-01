import { template as _$template } from "r-dom";
import { insert as _$insert } from "r-dom";
import { createComponent as _$createComponent } from "r-dom";
import { Show as _$Show } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(`<span>Visible`),
  _tmpl$2 = /*#__PURE__*/ _$template(`<span>On`),
  _tmpl$3 = /*#__PURE__*/ _$template(`<span>Off`),
  _tmpl$4 = /*#__PURE__*/ _$template(`<div>`),
  _tmpl$5 = /*#__PURE__*/ _$template(`<em>anonymous`),
  _tmpl$6 = /*#__PURE__*/ _$template(`<strong>`);
export function Badge({ show }) {
  return _$createComponent(_$Show, {
    when: show,
    get children() {
      return _tmpl$();
    }
  });
}
export const Toggle = ({ on }) =>
  _$createComponent(_$Show, {
    when: on,
    get fallback() {
      return _tmpl$3();
    },
    get children() {
      return _tmpl$2();
    }
  });
export function WithSetup({ user }) {
  var _el$4 = _tmpl$4();
  _$insert(
    _el$4,
    _$createComponent(_$Show, {
      when: user,
      get fallback() {
        return _tmpl$5();
      },
      get children() {
        return (() => {
          const label = user.name.trim();
          var _el$6 = _tmpl$6();
          _$insert(_el$6, label);
          return _el$6;
        })();
      }
    })
  );
  return _el$4;
}
