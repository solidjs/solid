/**
 * #5255: a guess's probe record (`_probes`) holds its readers weakly, so a
 * probe reader mounted and disposed while the guess is out is not kept by it
 * until the guess's next new question or its end. A live probe through that
 * churn is still woken by the next input change.
 *
 * The action's hold also keeps the readers it re-runs or holds (`_reruns`,
 * `_nodes`) until it lands, on main too; once it lands, nothing keeps them.
 */
import { Session } from "node:inspector/promises";
import { afterEach, expect, it } from "vitest";
import {
  action,
  createOptimistic,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  getOwner,
  isPending
} from "../src/index.js";

async function collectGarbage() {
  // WeakRef targets survive the job that created them.
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  const inspector = new Session();
  inspector.connect();
  try {
    await inspector.post("HeapProfiler.collectGarbage");
    await inspector.post("HeapProfiler.collectGarbage");
  } finally {
    inspector.disconnect();
  }
}
const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

let roots: (() => void)[] = [];
afterEach(async () => {
  roots.forEach(d => d());
  roots = [];
  await tick();
});

/** A guess out: `c` answered 4, the post guessed 9 and waits on `land()`. */
async function guessOut() {
  const h: any = {};
  createRoot(dispose => {
    roots.push(dispose);
    const [sel, setSel] = createSignal(3);
    h.setSel = setSel;
    const [c, set] = createOptimistic(async () => {
      h.node = getOwner();
      return sel() === 3 ? 4 : new Promise<number>(() => {});
    });
    h.c = c;
    h.post = action(function* () {
      set(9);
      yield new Promise(res => (h.land = res));
    });
  });
  await tick();
  h.post();
  flush();
  await tick();
  return h;
}

/** Mounts and disposes `n` probe readers of `c`; weak refs to what each kept. */
function churn(c: () => number, n: number): WeakRef<object>[] {
  const refs: WeakRef<object>[] = [];
  for (let i = 0; i < n; i++) {
    const dispose = createRoot(dispose => {
      const payload = { reader: i };
      refs.push(new WeakRef(payload));
      createRenderEffect(
        () => (payload.reader, isPending(c)),
        () => {}
      );
      return dispose;
    });
    flush();
    dispose();
    flush();
  }
  return refs;
}

it("50 probe readers churned while the guess is out are not kept by the probe record; a live probe still wakes", async () => {
  const h = await guessOut();
  let p = "";
  createRoot(dispose => {
    roots.push(dispose);
    createRenderEffect(
      () => String(isPending(h.c)),
      v => void (p = v)
    );
  });
  flush();
  expect(p).toBe("false");
  churn(h.c, 50);
  // Unsized and not iterable: the record cannot keep the 50 disposed readers.
  expect(h.node._x._probes).toBeInstanceOf(WeakMap);
  h.setSel(1);
  flush();
  await tick();
  expect(p).toBe("true");
});

it("probe readers disposed while the guess is out are released once the post lands", async () => {
  const h = await guessOut();
  const refs = churn(h.c, 50);
  h.land();
  await tick();
  expect(h.node._x._probes).toBeUndefined();
  await collectGarbage();
  expect(refs.filter(r => r.deref() !== undefined).length).toBe(0);
});
