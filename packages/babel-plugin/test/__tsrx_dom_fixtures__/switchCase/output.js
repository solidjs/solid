import { template as _$template } from "r-dom";
import { insert as _$insert } from "r-dom";
import { createComponent as _$createComponent } from "r-dom";
import { Match as _$Match } from "r-dom";
import { Switch as _$Switch } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(`<p>Loading...`),
  _tmpl$2 = /*#__PURE__*/ _$template(`<p class=success>Done!`),
  _tmpl$3 = /*#__PURE__*/ _$template(`<p>Unknown status.`),
  _tmpl$4 = /*#__PURE__*/ _$template(`<h1>Wide`),
  _tmpl$5 = /*#__PURE__*/ _$template(`<h2>Narrow`),
  _tmpl$6 = /*#__PURE__*/ _$template(`<header>`);
export const StatusMessage = ({ status }) =>
  _$createComponent(_$Switch, {
    get fallback() {
      return _tmpl$3();
    },
    get children() {
      return [
        _$createComponent(_$Match, {
          when: status === "loading",
          get children() {
            return _tmpl$();
          }
        }),
        _$createComponent(_$Match, {
          when: status === "success",
          get children() {
            return _tmpl$2();
          }
        })
      ];
    }
  });
export function NoDefault({ mode }) {
  var _el$4 = _tmpl$6();
  _$insert(
    _el$4,
    _$createComponent(_$Switch, {
      get children() {
        return [
          _$createComponent(_$Match, {
            get when() {
              return mode.kind === "wide";
            },
            get children() {
              return _tmpl$4();
            }
          }),
          _$createComponent(_$Match, {
            get when() {
              return mode.kind === "narrow";
            },
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
