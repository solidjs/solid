import { template as _$template } from "r-dom";
import { insert as _$insert } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(`<article title=🎉><p>🚀: `),
  _tmpl$2 = /*#__PURE__*/ _$template(`<strong>你好 🌍`),
  _tmpl$3 = /*#__PURE__*/ _$template(`<em>再见`);
const celebration = "🎉";
export function 国際化({ user, visible }) {
  const marker = "🚀";
  var _el$ = _tmpl$(),
    _el$2 = _el$.firstChild;
  _$insert(_el$2, () => user.名前, null);
  _$insert(_el$, visible ? _tmpl$2() : _tmpl$3(), null);
  return _el$;
}
