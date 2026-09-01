import { template as _$template } from "r-dom";
import { delegateEvents as _$delegateEvents } from "r-dom";
import { setAttribute as _$setAttribute } from "r-dom";
import { effect as _$effect } from "r-dom";
import { insert as _$insert } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(`<button>: <!>`);
export function LazyScope({ model }) {
  let __lazy0 = model;
  const outer = () => __lazy0.count;
  const inner = count => count + 1;
  const snapshot = {
    count: __lazy0.count,
    label: __lazy0.label
  };
  const update = () => {
    __lazy0.count += 1;
    __lazy0.count++;
    ++__lazy0.count;
    __lazy0.count = inner(__lazy0.count);
  };
  var _el$ = _tmpl$(),
    _el$2 = _el$.firstChild,
    _el$3 = _el$2.nextSibling;
  _el$.$$click = update;
  _$insert(_el$, () => __lazy0.label, _el$2);
  _$insert(_el$, outer, _el$3);
  _$effect(
    () => snapshot.count,
    _v$ => {
      _$setAttribute(_el$, "data-count", _v$);
    }
  );
  return _el$;
}
_$delegateEvents(["click"]);
