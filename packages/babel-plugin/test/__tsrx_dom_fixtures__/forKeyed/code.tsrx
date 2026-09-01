export function TodoList({ items }) @{
  <ul>
    @for (const item of items.filter((item) => !item.hidden); index i; key item.id) {
      <li>{i + 1}. {item.text}</li>
    } @empty {
      <li>No todos</li>
    }
  </ul>
}

export function WithSetup({ posts }) @{
  <ol>
    @for (const post of posts; index n) {
      const heading = post.title.trim();
      <li>
        <h3>{heading}</h3>
        <p>#{n}</p>
      </li>
    }
  </ol>
}
