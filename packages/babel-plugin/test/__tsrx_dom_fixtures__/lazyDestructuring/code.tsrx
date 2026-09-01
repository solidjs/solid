import { createSignal } from "solid-js";

let &[theme, setTheme] = createSignal("light");

export function ThemeLabel() @{
  <span onClick={() => setTheme("dark")}>{theme}</span>
}

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

export function FromObject({ user }) @{
  const &{ name, address } = user;

  <address>
    {name} / {address.city}
  </address>
}
