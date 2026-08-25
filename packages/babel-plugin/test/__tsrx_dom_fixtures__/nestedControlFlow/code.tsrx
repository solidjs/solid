export function Grid({ rows, dense }) @{
  <table>
    <tbody>
      @for (const row of rows; key row.id) {
        <tr>
          @if (dense) {
            <td class="dense">{row.cells.length}</td>
          } @else {
            @for (const cell of row.cells; index c) {
              <td>{c}: {cell}</td>
            } @empty {
              <td>empty row</td>
            }
          }
        </tr>
      }
    </tbody>
  </table>
}
