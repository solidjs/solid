import { createEffect, createRoot, createSignal } from "../src";
const [count, setCount] = createSignal(0);
createRoot(() => {
  createEffect(() => {
    console.log(count());
  });
  setCount(2);
});
