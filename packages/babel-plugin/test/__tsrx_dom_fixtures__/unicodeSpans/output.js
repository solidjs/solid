import { template as _$template } from "r-dom";
import { createComponent as _$createComponent } from "r-dom";
import { Show as _$Show } from "r-dom";
import { insert as _$insert } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(`<strong>你好 🌍`),
  _tmpl$2 = /*#__PURE__*/ _$template(`<article title=🎉><p>🚀: `),
  _tmpl$3 = /*#__PURE__*/ _$template(`<em>再见`);
const celebration = "🎉";
export function 国際化({ user, visible }) {
  const marker = "🚀";
  const __lazy0 = user;
  var _el$ = _tmpl$2(),
    _el$2 = _el$.firstChild,
    _el$3 = _el$2.firstChild;
  _$insert(_el$2, () => __lazy0.名前, null);
  _$insert(
    _el$,
    _$createComponent(_$Show, {
      when: visible,
      get fallback() {
        return _tmpl$3();
      },
      get children() {
        return _tmpl$();
      }
    }),
    null
  );
  return _el$;
}
