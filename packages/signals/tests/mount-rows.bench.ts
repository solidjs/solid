// Synchronous mount scaling (#3350 repro shape): a mapArray of N rows, each
// creating a memo read by a sync render effect plus a user effect over a
// per-row ref signal. Every user effect created during the mount parks in
// the pure heap until the effect phase; each row's first mid-tick memo pull
// then ran markHeap. Before the fix an unmarked insertion invalidated the
// markHeap memo, so every pull re-walked the whole heap — O(N²) (4× per 2×
// N). Now the insertion marks the node in place and the mount is linear.
import { bench, describe } from "vitest";
import {
  createEffect,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  mapArray
} from "../src/index.js";

function mount(N: number, withEffect: boolean) {
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
        if (withEffect) {
          const [el, setEl] = createSignal<object | null>(null, { ownedWrite: true });
          createEffect(
            () => el(),
            () => {}
          );
          setEl({ i });
        }
        return visible;
      })
    );
    createRenderEffect(
      () => rows().length,
      () => {}
    );
    flush();
    setItems(Array.from({ length: N }, (_, i) => i));
    flush();
    dispose();
  });
}

for (const N of [1000, 4000]) {
  describe(`mount ${N} rows`, () => {
    bench("memo + sync render effect + user effect over a ref signal (#3350)", () => {
      mount(N, true);
    });
    bench("memo + sync render effect only (reference)", () => {
      mount(N, false);
    });
  });
}
