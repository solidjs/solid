export function TodoList({ items }) @{
  <ul>
    @for (const item of items; index i; key item.id) {
      <li>{i + 1}. {item.text}</li>
    } @empty {
      <li>No todos</li>
    }
  </ul>
}
