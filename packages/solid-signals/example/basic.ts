import { createEffect, createRoot, createSignal, createStore } from "../src";

const [count, setCount] = createSignal(0);

createRoot(() => {
  createEffect(() => {
    console.log(count());
  });

  setCount(2);
});

const [store, setStore] = createStore({
  count: 0,
  get doubleCount() {
    return this.count * 2;
  },
});

createRoot(() => {
  createEffect(() => {
    console.log(store.count, store.doubleCount);
  });

  setStore((s) => (s.count = 2));
});
