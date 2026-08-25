export const App = () => (
  <ul data-x="dq" data-y='sq &amp; ent'>
    {items.map(item => (
      <li key={item.id} style={{ color: 'red' }}>
        {item.name} text &lt; entity
        <Nested.Deep.Comp {...item} />
        <>{/* fragment comment */}</>
      </li>
    ))}
  </ul>
);
