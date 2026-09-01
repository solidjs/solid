import { template as _$template } from "r-dom";
import { insert as _$insert } from "r-dom";
import { claimElement as _$claimElement } from "r-dom";
import { createComponent as _$createComponent } from "r-dom";
import { Match as _$Match } from "r-dom";
import { Switch as _$Switch } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(`<span class="badge active">Online`),
  _tmpl$2 = /*#__PURE__*/ _$template(`<span class="badge idle">Away`),
  _tmpl$3 = /*#__PURE__*/ _$template(`<span class=badge>Offline`),
  _tmpl$4 = /*#__PURE__*/ _$template(`<a href=/a>A`),
  _tmpl$5 = /*#__PURE__*/ _$template(`<button>B`),
  _tmpl$6 = /*#__PURE__*/ _$template(`<div>`);
export const StatusBadge = ({ status }) =>
  _$createComponent(_$Switch, {
    get fallback() {
      return _tmpl$3();
    },
    get children() {
      return [
        _$createComponent(_$Match, {
          when: status === "active",
          get children() {
            return _tmpl$();
          }
        }),
        _$createComponent(_$Match, {
          when: status === "idle",
          get children() {
            return _tmpl$2();
          }
        })
      ];
    }
  });
export function NoElse({ kind }) {
  var _el$4 = _tmpl$6();
  _$insert(
    _el$4,
    _$createComponent(_$Switch, {
      get children() {
        return [
          _$createComponent(_$Match, {
            when: kind === "a",
            get children() {
              var _el$5 = _tmpl$4();
              _$claimElement(_el$5);
              return _el$5;
            }
          }),
          _$createComponent(_$Match, {
            when: kind === "b",
            get children() {
              return _tmpl$5();
            }
          })
        ];
      }
    })
  );
  return _el$4;
}
