import { template as _$template } from "r-dom";
import { insert as _$insert } from "r-dom";
import { createComponent as _$createComponent } from "r-dom";
import { Loading as _$Loading } from "r-dom";
import { Errored as _$Errored } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(`<span>ready`),
  _tmpl$2 = /*#__PURE__*/ _$template(`<main><!><!>`),
  _tmpl$3 = /*#__PURE__*/ _$template(`<p>`),
  _tmpl$4 = /*#__PURE__*/ _$template(`<p>pending`),
  _tmpl$5 = /*#__PURE__*/ _$template(`<em>`);
import { Profile } from "./profile.js";
export function Matrix() {
  var _el$ = _tmpl$2(),
    _el$3 = _el$.firstChild,
    _el$4 = _el$3.nextSibling;
  _$insert(
    _el$,
    _$createComponent(_$Errored, {
      fallback: error =>
        (() => {
          var _el$5 = _tmpl$3();
          _$insert(_el$5, () => error().message);
          return _el$5;
        })(),
      get children() {
        return _$createComponent(_$Loading, {
          get fallback() {
            return _tmpl$4();
          },
          get children() {
            return _$createComponent(Profile, {});
          }
        });
      }
    }),
    _el$3
  );
  _$insert(
    _el$,
    _$createComponent(_$Errored, {
      fallback: failure =>
        (() => {
          var _el$7 = _tmpl$5();
          _$insert(_el$7, () => failure().name);
          return _el$7;
        })(),
      get children() {
        return _tmpl$();
      }
    }),
    _el$4
  );
  return _el$;
}
