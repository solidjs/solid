// Selection-map micro-bench (jf `select` op shape): one store object with N
// subscribed keys (one render effect per row reading selected[id]), toggling
// two keys per tick. This is the workload the written-keys bound (wk) exists
// for — the notify should visit O(written)=2 nodes, not all N.
import { bench } from "vitest";
import { createRenderEffect, createRoot, createStore, flush } from "../../src/index.js";

const N = 1000;

function setup() {
  let toggle!: (prev: number, next: number) => void;
  let sink = 0;
  const dispose = createRoot(d => {
    const seed: Record<string, boolean> = {};
    for (let i = 0; i < N; i++) seed["row" + i] = false;
    const [selected, setSelected] = createStore(seed);
    for (let i = 0; i < N; i++) {
      const key = "row" + i;
      createRenderEffect(
        () => selected[key],
        v => {
          sink += v ? 1 : 0;
        }
      );
    }
    toggle = (prev, next) => {
      setSelected(s => {
        s["row" + prev] = false;
        s["row" + next] = true;
      });
    };
    return d;
  });
  flush();
  return { toggle, dispose, sink: () => sink };
}

const ctx = setup();
let cur = 0;

bench("selection map: toggle 2 of 1000 subscribed keys", () => {
  for (let i = 0; i < 100; i++) {
    const next = (cur + 1) % N;
    ctx.toggle(cur, next);
    flush();
    cur = next;
  }
});

// The input-burst shape: repeated single-key writes to a SMALL store (few
// subscribers) — the case where per-write bookkeeping is pure overhead.
function setupSmall() {
  let write!: (v: string) => void;
  let sink = 0;
  const dispose = createRoot(d => {
    const [form, setForm] = createStore({ value: "", touched: false });
    createRenderEffect(
      () => form.value,
      v => {
        sink += v.length;
      }
    );
    write = v => {
      setForm(s => {
        s.value = v;
      });
    };
    return d;
  });
  flush();
  return { write, dispose, sink: () => sink };
}

const small = setupSmall();
let n = 0;

bench("input burst: 200 single-key writes, 1 subscriber", () => {
  for (let i = 0; i < 200; i++) {
    small.write("input-" + n++);
    flush();
  }
});
