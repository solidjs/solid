import { template as _$template } from "r-dom";
import { setAttribute as _$setAttribute } from "r-dom";
import { effect as _$effect } from "r-dom";
var _tmpl$ = /*#__PURE__*/ _$template(`<td> `);
// Every scope here KEEPS the classic grouped effect:
// - reassigned subject (fallback re-reads the reference per run)
function reassigned() {
  let row = first();
  row = second();
  var _el$ = _tmpl$(),
    _el$2 = _el$.firstChild;
  _$effect(
    () => row.label,
    _v$ => {
      _el$2.data = _v$;
    }
  );
  return _el$;
}
// - no member chain roots the scope (calls have no dispatch source)
function noSubject(get) {
  var _el$3 = _tmpl$(),
    _el$4 = _el$3.firstChild;
  _$effect(
    () => get(),
    _v$ => {
      _el$4.data = _v$;
    }
  );
  return _el$3;
}
// - dynamic-key step breaks the static chain
function dynamicStep(row, i) {
  var _el$5 = _tmpl$(),
    _el$6 = _el$5.firstChild;
  _$effect(
    () => row.queries[i].elapsed,
    _v$ => {
      _el$6.data = _v$;
    }
  );
  return _el$5;
}
// - a BARE subject read is STATIC in classic emission (plain identifiers
//   are not dynamic bindings) and never enters the scope's dynamics; this
//   scope still declines because `row` is assigned SOMEWHERE in the module
//   (program-wide name conservatism, matching the Oxc binding table)
function bareRead(row) {
  var _el$7 = _tmpl$(),
    _el$8 = _el$7.firstChild;
  _$setAttribute(_el$7, "data-row", row);
  _$effect(
    () => row.label,
    _v$ => {
      _el$8.data = _v$;
    }
  );
  return _el$7;
}
