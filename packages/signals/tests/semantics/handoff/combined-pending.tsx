import { render } from "@solidjs/web";
import { createMemo, createSignal, isPending } from "solid-js";

const delay = <T = void,>(ms: number, value?: T) => new Promise<T>(r => setTimeout(r, ms, value));

export default function App() {
  const [count, setCount] = createSignal(0);
  const slow = createMemo(() => delay(1000, count()));
  const fast = createMemo(async () => count());
  const copy = createMemo(() => slow());

  return (
    <>
      <button onClick={() => setCount(1)}>Run</button>
      <p>Pending: {String(isPending(() => [fast(), copy()]))}</p>
      <p>Fast: {fast()}</p>
      <p>Slow: {copy()}</p>
    </>
  );
}

render(() => <App />, document.getElementById("root")!);
