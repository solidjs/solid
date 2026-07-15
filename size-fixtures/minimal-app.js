// The "simple app" floor: render + one signal. Tracks the tree-shaken cost a
// hello-world CSR app ships (#2883).
import { render } from "@solidjs/web";
import { createSignal } from "solid-js";

const [count, setCount] = createSignal(0);
render(() => {
  const el = document.createElement("button");
  el.onclick = () => setCount(count() + 1);
  return el;
}, document.getElementById("app"));
