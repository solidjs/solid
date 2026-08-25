// `$key` on an intrinsic element compiles to the `_key` attribute the
// frame morph matches keyed elements by. Static keys inline into the
// template; dynamic keys render as ordinary dynamic attributes. On a
// component, `$key` is slot occurrence identity — a prop the runtime owns —
// so it must pass through unrenamed.
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
