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
    mount(200); // warm
    // The quadratic regime measured ~760ms at 8000 rows here (4× per 2× N);
    // the linear one ~35ms. Leave room for shared CI runners while keeping
    // the O(N²) regime far above the tripwire.
    expect(mount(8000)).toBeLessThan(250);
  });

  it("a write landing between two mid-tick pulls is visible through a memo chain in the same pass", () => {
    // The first sync render effect's read marks the heap; the row's write
    // then inserts an UNMARKED subscriber (doubled) into the marked heap.
    // Its downstream memo (label) must be pulled fresh by the next sync
    // reader in the same flush — the eager mark has to propagate CHECK past
    // the inserted node, not just flag the node itself.
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
    // Each row's first run sees its own write; earlier rows' effects then
    // settle on the final value when the label memo lands in the heap pass.
    expect(seen.slice(0, 3)).toEqual(["n=22", "n=24", "n=26"]);
    expect(seen.slice(3)).toEqual(["n=26", "n=26"]);
  });
});
