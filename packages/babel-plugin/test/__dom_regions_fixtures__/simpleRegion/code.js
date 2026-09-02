// Depth-1 subject: every binding is a static member read of one constant
// record — the whole scope rides one region with raw commit reads.
function Row(row) {
  return (
    <tr>
      <td textContent={row.id} />
      <td textContent={row.label} />
      <td data-status={row.done ? "done" : "pending"} />
    </tr>
  );
}
