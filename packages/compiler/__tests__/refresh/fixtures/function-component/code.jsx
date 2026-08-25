import { createSignal } from 'solid-js';

const LIMIT = 10;

export default function App() {
  // increment handler
  const [count, setCount] = createSignal(0);
  const inc = () => setCount(count() + 1);
  if (count() > LIMIT) console.log('big');
  return <button onClick={inc}>{count()}</button>;
}
