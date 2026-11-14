/**
 * Store data to an effect's callback (the back half): the compute returns
 * `deep(store)`, which tracks every key and hands the callback a plain copy.
 * A held action write reaches the callback at its settle, and a setter's
 * write at its flush (F-10). `snapshot()` alone tracks nothing: the compute
 * re-runs only when something it does track changes. Both engines agree
 * (thin-store spike, 2026-11-14).
 */
import { expect, it } from "vitest";
import {
  $TARGET,
  action,
  createEffect,
  createRoot,
  createSignal,
  createStore,
  deep,
  flush,
  snapshot
} from "../../src/index.js";
import { $THIN } from "../../src/store/types.js";

const isProxy = (v: any) => !!(v?.[$TARGET] || v?.[$THIN]);

it("deep(store) in the compute: every key tracked, a plain copy to the callback", async () => {
  const [s, setS] = createStore({ a: 1, n: { b: 1 } });
  const got: any[] = [];
  createRoot(() =>
    createEffect(
      () => deep(s),
      v => void got.push(v)
    )
  );
  flush();
  expect(got).toEqual([{ a: 1, n: { b: 1 } }]);
  expect(isProxy(got[0]) || isProxy(got[0].n)).toBe(false);

  setS(d => {
    d.n.b = 5;
  });
  expect(got.length).toBe(1); // F-10: at the flush, not before
  flush();
  expect(got.at(-1)).toEqual({ a: 1, n: { b: 5 } });

  let go!: () => void;
  const act = action(function* () {
    setS(d => {
      d.a = 9;
    });
    yield new Promise<void>(r => (go = r));
  })();
  flush();
  expect(got.at(-1)).toEqual({ a: 1, n: { b: 5 } }); // held
  go();
  await act;
  flush();
  expect(got.at(-1)).toEqual({ a: 9, n: { b: 5 } });
});

it("snapshot(store) in the compute tracks nothing: fresh data only when a tracked input re-runs it", () => {
  const [s, setS] = createStore({ a: 1 });
  const [x, setX] = createSignal(0);
  const got: number[] = [];
  createRoot(() =>
    createEffect(
      () => (x(), snapshot(s)),
      v => void got.push(v.a)
    )
  );
  flush();
  setS(d => {
    d.a = 2;
  });
  flush();
  expect(got).toEqual([1]);
  setX(1);
  flush();
  expect(got).toEqual([1, 2]);
});
