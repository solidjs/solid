// A single eligible binding still regionizes (no grouped-effect special
// case: one body, one baseline slot).
function Cell(row) {
  return <td textContent={row.label} />;
}
