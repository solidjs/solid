import { template as _$template } from "r-dom";
import { delegateEvents as _$delegateEvents } from "r-dom";
import { insert as _$insert } from "r-dom";
import { createComponent as _$createComponent } from "r-dom";
import { Loading as _$Loading } from "r-dom";
import { Errored as _$Errored } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(`<div><p>Error: </p><button>Try again`),
  _tmpl$2 = /*#__PURE__*/ _$template(`<p>Loading...`),
  _tmpl$3 = /*#__PURE__*/ _$template(`<p>: <!>`);
import { Profile } from "./profile.js";
export const App = () =>
  _$createComponent(_$Errored, {
    fallback: (e, reset) =>
      (() => {
        var _el$ = _tmpl$(),
          _el$2 = _el$.firstChild,
          _el$3 = _el$2.firstChild,
          _el$4 = _el$2.nextSibling;
        _$insert(_el$2, () => e().message, null);
        _el$4.$$click = () => reset();
        return _el$;
      })(),
    get children() {
      return _$createComponent(_$Loading, {
        get fallback() {
          return _tmpl$2();
        },
        get children() {
          return _$createComponent(Profile, {
            id: 1
          });
        }
      });
    }
  });
export const PendingOnly = () =>
  _$createComponent(_$Loading, {
    get fallback() {
      return _tmpl$2();
    },
    get children() {
      return _$createComponent(Profile, {
        id: 2
      });
    }
  });
export const CatchOnly = () =>
  _$createComponent(_$Errored, {
    fallback: err =>
      (() => {
        var _el$7 = _tmpl$3(),
          _el$8 = _el$7.firstChild,
          _el$9 = _el$8.nextSibling;
        _$insert(_el$7, () => err().name, _el$8);
        _$insert(_el$7, () => String(err()), _el$9);
        return _el$7;
      })(),
    get children() {
      return _$createComponent(Profile, {
        id: 3
      });
    }
  });
_$delegateEvents(["click"]);
