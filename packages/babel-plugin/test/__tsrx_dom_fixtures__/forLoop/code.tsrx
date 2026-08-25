export function List({ items }) @{
  <ul>
    @for (const item of items) {
      <li>{item}</li>
    }
  </ul>
}

export const Rows = ({ rows }) =>
  <tbody>
    @for (const { id, label } of rows) {
      <tr>
        <td>{id}</td>
        <td>{label}</td>
      </tr>
    }
  </tbody>;
