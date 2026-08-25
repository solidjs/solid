import { createSignal } from "solid-js";

export function UserCard(&{ name, age }) @{
  <div>
    <h2>{name}</h2>
    <p>Age: {age}</p>
  </div>
}

export function Counter() @{
  let &[count, setCount] = createSignal(0);

  <button onClick={() => setCount(count() + 1)}>Count: {count}</button>
}
