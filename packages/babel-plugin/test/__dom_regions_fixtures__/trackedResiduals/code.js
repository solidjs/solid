// The jfb row: a dynamic-key read of a FOREIGN store is a tracked residual
// in the compute; its DIRECT depth-1 subject read (row.id) rides the raw
// parameter (_u$) — the deep witness already wakes the compute. The classic
// fallback passes the proxy as _u$, keeping the same code per-key tracked.
function Row(row, selection) {
  return (
    <tr class={selection[row.id] ? "danger" : ""}>
      <td textContent={row.id} />
      <td textContent={row.label} />
    </tr>
  );
}
