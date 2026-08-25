// `$key` is server markup identity (SSR-only): a DOM compile strips it from
// intrinsic elements — client-owned DOM is never morph-managed, and a
// literal `$key` attribute is never intended output. On a component, `$key`
// is slot occurrence identity — a prop the runtime owns — so it must pass
// through unrenamed.
const staticKey = (
  <ul>
    <li $key="a">Apple</li>
  </ul>
);

const dynamicKey = (
  <ul>
    <li $key={item.id} class={item.cls}>
      {item.text}
    </li>
  </ul>
);

const componentKey = <Row $key={item.id} text={item.text} />;
