export function Rows({ rows }) @{
  <ul>
    @for (const row of rows; index index; key row.id) {
      const snapshot = row;
      const preserve = (row, index) => row + index;

      <li
        data-row={snapshot}
        data-index={index}
        onClick={() => preserve("local", 0)}
      >
        {row} / {row.name} / {row()} / {index} / {index()}
      </li>
    }
  </ul>
}
