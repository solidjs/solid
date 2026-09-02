// Region and classic scopes coexist in one module: both wrappers import.
function RegionRow(row) {
  return <td textContent={row.label} />;
}
function ClassicRow(get) {
  return <td textContent={get()} />;
}
