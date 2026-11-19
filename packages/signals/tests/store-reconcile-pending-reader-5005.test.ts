// #5005: while an action holds `a`, a reconcile() that repeats a's staged
// value and changes `b` must publish `b` the same way whether or not a live
// effect reads `b` (an observer never changes what an ordinary read
// returns; F-10). Only `a` is held (F-2).
import { test, expect } from "vitest";
import {
  action,
  createRenderEffect,
  createRoot,
  createStore,
  flush,
  reconcile
} from "../src/index.js";

async function run(watched: boolean) {
  const [state, set] = createStore({ a: 0, b: 0 });
  const stop = createRoot(dispose => {
    if (watched)
      createRenderEffect(
        () => state.b,
        () => {}
      );
    return dispose;
  });
  let open!: () => void;
  const gate = new Promise<void>(r => (open = r));
  const done = action(function* () {
    set(d => {
      d.a = 1;
    });
    yield gate;
  })();
  flush();
  set(reconcile({ a: 1, b: 1 }));
  flush();
  const during = [state.a, state.b];
  open();
  await done;
  flush();
  const after = [state.a, state.b];
  stop();
  return { during, after };
}

test("#5005 with a reader on b, reconcile publishes b during the pending action", async () => {
  expect(await run(true)).toEqual({ during: [0, 1], after: [1, 1] });
});

test("#5005 without a reader on b, reconcile publishes b during the pending action", async () => {
  expect(await run(false)).toEqual({ during: [0, 1], after: [1, 1] });
});
