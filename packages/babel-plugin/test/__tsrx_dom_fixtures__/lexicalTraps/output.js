import { template as _$template } from "r-dom";
import { insert as _$insert } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(
  `<pre title=@\{>literal @\{ value } / @\{ not a block } / &amp;\{ not a lazy pattern } / `
);
const template = `literal @{ ${"value"} }`;
export function LexicalTraps({ value }) {
  const block = "@{ not a block }";
  const lazy = "&{ not a lazy pattern }";
  var _el$ = _tmpl$(),
    _el$2 = _el$.firstChild;
  _$insert(_el$, value, null);
  return _el$;
}
