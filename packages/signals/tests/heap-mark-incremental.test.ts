/**
 * #3350: mounting N rows in one flush was O(N²).
 *
 * Writes schedule subscribers by heap insertion alone; DIRTY/CHECK marks are
 * propagated lazily by markHeap, memoized on `heap._marked` until runHeap
 * resets it. An unmarked node entering an already-marked heap used to
 * invalidate that memo, so the next mid-tick pull re-walked the entire heap.
 * A synchronous mount creating a user effect per row (each parked in the pure
 * heap until the effect phase) hit that on every row's first memo read.
 * Insertions now mark the incoming node in place instead.
 */
import {
  createEffect,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  mapArray
} from "../src/index.js";

function mount(N: number) {
  let ms = 0;
  createRoot(dispose => {
    const [zoom] = createSignal(1);
    const viewport = createMemo(() => 600 / zoom());
    const [items, setItems] = createSignal<number[]>([], { ownedWrite: true });
    const rows = createMemo(
      mapArray(items, i => {
        const visible = createMemo(() => i * 10 < viewport());
        createRenderEffect(
          () => visible(),
          () => {},
          { sync: true } as any
        );
        const [el, setEl] = createSignal<object | null>(null, { ownedWrite: true });
        createEffect(
          () => el(),
          () => {}
        );
        setEl({ i });
        return visible;
      })
    );
    createRenderEffect(
      () => rows().length,
      () => {}
    );
    flush();
    const start = performance.now();
    setItems(Array.from({ length: N }, (_, i) => i));
    flush();
    ms = performance.now() - start;
    dispose();
  });
  return ms;
}

describe("heap marking stays incremental across mid-tick pulls", () => {
  it("mounting rows with a per-row user effect is linear in N (#3350)", () => {
    // Relative tripwire: absolute wall-clock bounds do not survive the
    // coverage-instrumented CI job (12× slower than a local run). Compare 8×
    // the rows within one process instead — linear scaling lands near 8×,
    // the quadratic regime near 64×. Best-of-k tames JIT/GC noise at the
    // small end. Measured locally: ~10× fixed (3 → 30 ms), ~50× on next
    // (17 → 850 ms).
    const best = (N: number, k: number) => {
      let ms = Infinity;
      for (let i = 0; i < k; i++) ms = Math.min(ms, mount(N));
      return ms;
    };
    best(1000, 2); // warm
    const small = best(1000, 3);
    const large = best(8000, 2);
    expect(large / small).toBeLessThan(24);
  });

  it("a write landing between two mid-tick pulls is visible through a memo chain in the same flush", () => {
    // The first sync render effect's read marks the heap; the row's write is
    // promoted by the flush, which inserts an UNMARKED subscriber (doubled)
    // into the marked heap. Its downstream memo (label) must be pulled fresh
    // by the sync readers in the same flush — the eager mark has to propagate
    // CHECK past the inserted node, not just flag the node itself.
    const seen: string[] = [];
    createRoot(() => {
      const [base] = createSignal(1);
      const gate = createMemo(() => base() + 1);
      const [n, setN] = createSignal(0, { ownedWrite: true });
      const doubled = createMemo(() => n() * 2);
      const label = createMemo(() => `n=${doubled()}`);
      const [items, setItems] = createSignal<number[]>([], { ownedWrite: true });
      const rows = createMemo(
        mapArray(items, i => {
          createRenderEffect(
            () => gate(),
            () => {},
            { sync: true } as any
          );
          setN(i + 10);
          createRenderEffect(
            () => label(),
            v => {
              seen.push(v);
            },
            { sync: true } as any
          );
          return i;
        })
      );
      createRenderEffect(
        () => rows().length,
        () => {}
      );
      flush();
      setItems([1, 2, 3]);
      flush();
    });
    // A28: a write becomes visible at flush — each row's first run answers the
    // flushed value (its own write is unflushed until the promotion), then
    // the promotion lands the last write (13 * 2) and every row's effect
    // settles on it within the same flush. A stale tail would be n=0.
    expect(seen.slice(0, 3)).toEqual(["n=0", "n=0", "n=0"]);
    expect(seen.slice(3)).toEqual(["n=26", "n=26", "n=26"]);
  });
});
