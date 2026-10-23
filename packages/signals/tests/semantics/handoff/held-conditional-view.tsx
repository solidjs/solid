import { render } from "@solidjs/web";
import { createMemo, createSignal } from "solid-js";

const delay = <T = void,>(ms: number, value?: T) => new Promise<T>(r => setTimeout(r, ms, value));

export default function App() {
  const [count, setCount] = createSignal(0);
  const [show, setShow] = createSignal(true);
  const delayedShow = createMemo(() => delay(1000, show()));

  return (
    <>
      <button
        onClick={async () => {
          setShow(false);
          await delay(500);
          setCount(1);
        }}
      >
        Run
      </button>
      <p>Count: {count()}</p>
      <p>Show: {String(show())}</p>
      <p>Panel: {show() ? count() : "hidden"}</p>
      <p>Delayed show: {String(delayedShow())}</p>
    </>
  );
}

render(() => <App />, document.getElementById("root")!);
