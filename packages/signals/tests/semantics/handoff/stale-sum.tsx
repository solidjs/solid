import { render } from "@solidjs/web";
import { createMemo, createSignal } from "solid-js";

const delay = <T = void,>(ms: number, value?: T) => new Promise<T>(r => setTimeout(r, ms, value));

export default function App() {
  const [inputA, setA] = createSignal(0);
  const [inputB, setB] = createSignal(0);
  const a = createMemo(() => delay(1000, inputA()));
  const b = createMemo(() => delay(1000, inputB()));
  const sum = createMemo(() => a() + b());

  return (
    <>
      <button
        onClick={async () => {
          setA(1);
          await delay(500);
          setB(1);
        }}
      >
        Run
      </button>
      <p>A: {a()}</p>
      <p>B: {b()}</p>
      <p>Sum: {sum()}</p>
    </>
  );
}

render(() => <App />, document.getElementById("root")!);
