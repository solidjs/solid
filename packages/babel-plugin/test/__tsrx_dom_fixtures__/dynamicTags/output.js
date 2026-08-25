import { template as _$template } from "r-dom";
import { createComponent as _$createComponent } from "r-dom";
import { insert as _$insert } from "r-dom";
import { Dynamic as _$Dynamic } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(`<h2>`);
export function Panel({ as = "section", title }) {
  return _$createComponent(_$Dynamic, {
    component: as,
    class: "panel",
    get children() {
      var _el$ = _tmpl$();
      _$insert(_el$, title);
      return _el$;
    }
  });
}
export function Pick({ expanded, ExpandedBody, CompactBody, item }) {
  const Body = expanded ? ExpandedBody : CompactBody;
  return _$createComponent(_$Dynamic, {
    component: Body,
    item: item
  });
}
