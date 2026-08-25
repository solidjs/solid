/**
 * #2899 — the optimistic layer (STORE_OPTIMISTIC_OVERRIDE) is one flat record
 * per store target, but concurrent actions writing disjoint keys must revert
 * independently: the first-settling action used to wipe the whole layer,
 * visibly reverting the other action's still-live overrides with no recovery
 * until its own settle. Node-level overrides already had per-transition
 * granularity via the transition's _optimisticNodes; the layer now carries
 * its half as per-key owner stamps (STORE_OPTIMISTIC_OWNERS), and a settling
 * transaction only consumes its own entries (merge chains resolved, ambient
 * entries clear on any flush-end/settle, projection landings still consume
 * everything).
 */
import {
  action,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  flush
} from "../src/index.js";

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => (resolve = r));
  return { promise, resolve };
}

it("#2899: first-settling action keeps other in-flight actions' overrides", async () => {
  const gateA = deferred();
  const gateB = deferred();
  const [s, setS] = createOptimisticStore({ a: 1, b: 2 });
  createRoot(() => {
    createRenderEffect(
      () => s.a,
      () => {}
    );
    createRenderEffect(
      () => s.b,
      () => {}
    );
  });
  flush();

  const actA = action(function* () {
    setS(d => {
      d.a = 10;
    });
    yield gateA.promise;
  });
  const actB = action(function* () {
    setS(d => {
      d.b = 20;
    });
    yield gateB.promise;
  });

  const pA = actA();
  flush();
  expect(s.a).toBe(10);
  const pB = actB();
  flush();
  expect(s.b).toBe(20);
  expect(s.a).toBe(10);

  gateB.resolve();
  await pB;
  flush();
  expect(s.b).toBe(2); // B settled: its override reverted
  expect(s.a).toBe(10); // A still in flight: its override survives

  gateA.resolve();
  await pA;
  flush();
  expect(s.a).toBe(1);
  expect(s.b).toBe(2);
});

it("#2899: disjoint rows of a nested store revert independently", async () => {
  const gateA = deferred();
  const gateB = deferred();
  const [rows, setRows] = createOptimisticStore([
    { id: 1, saving: false },
    { id: 2, saving: false }
  ]);
  createRoot(() => {
    createRenderEffect(
      () => rows.map(r => r.saving).join(),
      () => {}
    );
  });
  flush();

  const save = (i: number, gate: Promise<void>) =>
    action(function* () {
      setRows(d => {
        d[i].saving = true;
      });
      yield gate;
    })();

  const pA = save(0, gateA.promise);
  flush();
  const pB = save(1, gateB.promise);
  flush();
  expect(rows[0].saving).toBe(true);
  expect(rows[1].saving).toBe(true);

  gateA.resolve();
  await pA;
  flush();
  expect(rows[0].saving).toBe(false); // A settled
  expect(rows[1].saving).toBe(true); // B still in flight

  gateB.resolve();
  await pB;
  flush();
  expect(rows[1].saving).toBe(false);
});

it("#2899: same-key writes entangle — both actions' work reverts together at the joint settle", async () => {
  const gateA = deferred();
  const gateB = deferred();
  const [s, setS] = createOptimisticStore({ a: 1, b: 2 });
  createRoot(() => {
    createRenderEffect(
      () => s.a + s.b,
      () => {}
    );
  });
  flush();

  const pA = action(function* () {
    setS(d => {
      d.a = 10;
    });
    yield gateA.promise;
  })();
  flush();
  const pB = action(function* () {
    setS(d => {
      d.a = 11; // same key as A — transitions merge via the shared node
      d.b = 20;
    });
    yield gateB.promise;
  })();
  flush();
  expect(s.a).toBe(11);
  expect(s.b).toBe(20);

  gateB.resolve();
  await pB;
  flush();
  // Merged transaction: nothing settles until the LAST overlapping action.
  expect(s.a).toBe(11);
  expect(s.b).toBe(20);

  gateA.resolve();
  await pA;
  flush();
  expect(s.a).toBe(1);
  expect(s.b).toBe(2);
});

it("#2899: delete under a concurrent action survives the other action's settle", async () => {
  const gateA = deferred();
  const gateB = deferred();
  const [s, setS] = createOptimisticStore<{ a?: number; b?: number }>({ a: 1, b: 2 });
  createRoot(() => {
    createRenderEffect(
      () => [s.a, s.b].join(),
      () => {}
    );
  });
  flush();

  const pA = action(function* () {
    setS(d => {
      delete d.a;
    });
    yield gateA.promise;
  })();
  flush();
  const pB = action(function* () {
    setS(d => {
      d.b = 20;
    });
    yield gateB.promise;
  })();
  flush();
  expect("a" in s).toBe(false);
  expect(s.b).toBe(20);

  gateB.resolve();
  await pB;
  flush();
  expect("a" in s).toBe(false); // A's delete still live
  expect(s.b).toBe(2);

  gateA.resolve();
  await pA;
  flush();
  expect(s.a).toBe(1);
});

it("#2899: ambient write reverts at flush end without touching an in-flight action's keys", async () => {
  const gateA = deferred();
  const [s, setS] = createOptimisticStore({ a: 1, c: 3 });
  createRoot(() => {
    createRenderEffect(
      () => s.a + s.c,
      () => {}
    );
  });
  flush();

  const pA = action(function* () {
    setS(d => {
      d.a = 10;
    });
    yield gateA.promise;
  })();
  flush();
  expect(s.a).toBe(10);

  // Ambient optimistic write (no action): visible until its flush, then reverts.
  setS(d => {
    d.c = 30;
  });
  expect(s.c).toBe(30);
  flush();
  expect(s.c).toBe(3);
  expect(s.a).toBe(10); // action A's override untouched

  gateA.resolve();
  await pA;
  flush();
  expect(s.a).toBe(1);
});
