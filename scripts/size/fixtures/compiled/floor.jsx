// `app: compiled floor`: the smallest compiled app — one template, one text
// hole, one delegated handler, rendered fresh. The compiled counterpart of
// the hand-written "render + one signal" floor: the delta between the two
// is what a real template costs on top of the runtime a hand-written app
// already pays for (`template`, `insert` of a text hole, `delegateEvents`
// and the delegated-handler property).
import { render } from "@solidjs/web";
import { createSignal } from "solid-js";

function Counter() {
  const [count, setCount] = createSignal(0);
  return (
    <button type="button" onClick={() => setCount(count() + 1)}>
      Clicked {count()} times
    </button>
  );
}

render(() => <Counter />, document.getElementById("app"));
