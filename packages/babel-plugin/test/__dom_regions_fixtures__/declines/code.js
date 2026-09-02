// Every scope here KEEPS the classic grouped effect:
// - reassigned subject (fallback re-reads the reference per run)
function reassigned() {
  let row = first();
  row = second();
  return <td textContent={row.label} />;
}
// - no member chain roots the scope (calls have no dispatch source)
function noSubject(get) {
  return <td textContent={get()} />;
}
// - dynamic-key step breaks the static chain
function dynamicStep(row, i) {
  return <td textContent={row.queries[i].elapsed} />;
}
// - a BARE subject read is STATIC in classic emission (plain identifiers
//   are not dynamic bindings) and never enters the scope's dynamics; this
//   scope still declines because `row` is assigned SOMEWHERE in the module
//   (program-wide name conservatism, matching the Oxc binding table)
function bareRead(row) {
  return <td data-row={row} textContent={row.label} />;
}
