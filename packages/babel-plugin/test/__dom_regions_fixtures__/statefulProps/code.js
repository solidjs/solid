// class/style consume the previous VALUE — the baseline advances in a block
// after the write instead of inline in the setter argument.
function Row(row) {
  return (
    <tr class={row.selected ? "danger" : ""} style={row.style}>
      <td textContent={row.label} />
    </tr>
  );
}
