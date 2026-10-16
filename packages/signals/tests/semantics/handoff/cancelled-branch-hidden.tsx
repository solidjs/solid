import { render } from "@solidjs/web";
import { createMemo, createSignal } from "solid-js";

const delay = <T = void,>(ms: number, value?: T) => new Promise<T>(r => setTimeout(r, ms, value));

export default function App() {
  const [count, setCount] = createSignal(0);
  const [show, setShow] = createSignal(false);
  const details = createMemo(() => delay(1000, count()));
  const selected = createMemo(async () => (count() ? details() : 0));

  return (
    <>
      <button
        onClick={async () => {
          setShow(true);
          setCount(1);
          await delay(500);
          setCount(0);
        }}
      >
        Run
      </button>
      <p>Show: {String(show())}</p>
      <p>Panel: {show() ? selected() : "hidden"}</p>
    </>
  );
}

render(() => <App />, document.getElementById("root")!);
