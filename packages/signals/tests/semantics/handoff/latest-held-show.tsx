import { render } from "@solidjs/web";
import { action, createSignal, latest, Show } from "solid-js";

export default function App() {
  const [count, setCount] = createSignal(0);
  const save = action(function* () {
    setCount(1);
    yield new Promise<void>(r => setTimeout(r, 1000));
  });

  return (
    <>
      <button onClick={save}>Run</button>
      <p>Outside: {latest(count)}</p>
      <Show when={count() === 0}>
        <p>Inside: {latest(count)}</p>
      </Show>
    </>
  );
}

render(() => <App />, document.getElementById("root")!);
