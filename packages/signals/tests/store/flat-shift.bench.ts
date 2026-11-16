// A wide flat keyed list (UIBench's `tree/[500]`): every slot of the list
// holds a different row after the op, so each is a real write. A keyed
// `mapArray` (what `<For>` runs) reads every index; each row's effect reads
// one field.
import { bench, describe } from "vitest";
import {
  createRenderEffect,
  createRoot,
  createStore,
  flush,
  mapArray,
  reconcile
} from "../../src/index.js";

const N = 500;
type Row = { id: number; v: number };
let uid = N;
const base = (): Row[] => Array.from({ length: N }, (_, i) => ({ id: i, v: 0 }));

function setup() {
  let cur = base();
  const [s, set] = createStore<{ items: Row[] }>({ items: base() });
  let sum = 0;
  createRoot(() => {
    const rows = mapArray(
      () => s.items,
      item => {
        createRenderEffect(
          () => item.v,
          x => {
            sum += x;
          }
        );
        return item;
      }
    );
    createRenderEffect(rows, () => {});
  });
  set(reconcile({ items: cur }, "id"));
  flush();
  return (op: (a: Row[]) => Row[]) => {
    cur = op(cur);
    set(reconcile({ items: cur }, "id"));
    flush();
    return sum;
  };
}

const ops: Record<string, (a: Row[]) => Row[]> = {
  "insert first / remove first": a => (a[0].id >= N ? a.slice(1) : [{ id: ++uid, v: 0 }, ...a]),
  "move first to end": a => [...a.slice(1), a[0]],
  "worst case (snabbdom)": a => {
    const b = a.slice();
    const f = b.shift()!;
    const l = b.pop()!;
    b.splice(2, 0, f);
    b.splice(b.length - 3, 0, l);
    return b.reverse();
  },
  "anim: every 8th row a fresh object": a =>
    a.map((r, i) => (i % 8 === 0 ? { id: r.id, v: r.v + 1 } : r))
};

describe("flat keyed list, 500 rows", () => {
  for (const name in ops) {
    const step = setup();
    bench(name, () => void step(ops[name]));
  }
});
