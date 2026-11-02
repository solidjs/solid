/**
 * #4605 (ReactiveScript timing fuzzer): a keyed `createOptimisticStore` list
 * asked by `filter()`, under `<Loading on={filter()}>`. An action guesses
 * (removes a row), yields, then `refresh()`es the list. A `filter` write
 * while the action is out is held with it (D-34, #4336); the action ends,
 * the refresh lands, everything rests. A second `filter` write with nothing
 * in flight is an `on` change like any other: it arms the boundary, which
 * shows its fallback with that change's frame (F-5, D-15) — as it does
 * without `on`, and as it does without the earlier held change.
 */
import { describe, expect, it } from "vitest";
import {
  action,
  createLoadingBoundary,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createErrorBoundary,
  createSignal,
  flush,
  mapArray,
  refresh,
  untrack
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

function page(on: boolean) {
  const asks: { key: string; res: (v: any) => void }[] = [];
  const ask = (key: string) => new Promise<any>(res => asks.push({ key, res }));
  const land = async (key: string, v: any) => {
    const i = asks.findIndex(a => a.key === key);
    if (i < 0) throw new Error(`not asked: ${key}; asked: ${asks.map(a => a.key)}`);
    asks.splice(i, 1)[0].res(structuredClone(v));
    await tick();
  };
  const frames: string[] = [];
  let setFilter!: (f: string) => void;
  let closeOne!: (id: number) => void;
  createRoot(() => {
    const [filter, sf] = createSignal("open");
    setFilter = sf;
    const [issues, set] = createOptimisticStore<any[]>(() => ask(`issues:${filter()}`), [], {
      key: "id"
    } as any);
    closeOne = action(function* (id: number) {
      set((list: any[]) => {
        const i = list.findIndex(t => t.id === id);
        if (i >= 0) list.splice(i, 1);
      });
      yield ask(`close:${id}`);
      refresh(issues);
    }) as any;
    const view = untrack(() =>
      createLoadingBoundary(
        () =>
          createErrorBoundary(
            () => {
              const m = mapArray(
                () => issues,
                (it: any) => {
                  createRenderEffect(
                    () => it.id,
                    () => {}
                  );
                  return () => `#${it.id}`;
                }
              );
              return () =>
                `${filter()}: ` +
                m()
                  .map(f => f())
                  .join(" ");
            },
            () => "error"
          ),
        () => "loading",
        on ? { on: () => filter() } : undefined
      )
    );
    createRenderEffect(
      () => {
        let v: any = view();
        while (typeof v === "function") v = v();
        return v;
      },
      v => {
        if (frames.at(-1) !== v) frames.push(v);
      }
    );
  });
  return {
    land,
    asks,
    frames,
    screen: () => frames.at(-1),
    setFilter: async (f: string) => {
      setFilter(f);
      flush();
      await tick();
    },
    closeOne: async (id: number) => {
      closeOne(id);
      flush();
      await tick();
    }
  };
}

describe("#4605 an `on` change after an earlier change was held by an action", () => {
  for (const on of [true, false]) {
    it(`the later change, with nothing in flight (on=${on})`, async () => {
      const p = page(on);
      await tick();
      await p.land("issues:open", [{ id: 1 }, { id: 3 }, { id: 4 }]);
      expect(p.screen()).toBe("open: #1 #3 #4");
      await p.closeOne(3);
      expect(p.screen()).toBe("open: #1 #4");
      await p.setFilter("closed");
      expect(p.screen()).toBe("open: #1 #4");
      await p.land("issues:closed", [{ id: 2 }]);
      expect(p.screen()).toBe("open: #1 #4");
      await p.land("close:3", {});
      expect(p.screen()).toBe("open: #1 #4");
      await p.land("issues:closed", [{ id: 2 }, { id: 3 }]);
      expect(p.screen()).toBe("closed: #2 #3");
      expect(p.asks).toEqual([]);
      await p.setFilter("open");
      // F-5/D-15: `on` arms and the fallback lands with the change; without
      // `on` the shown boundary forwards and the change holds.
      expect(p.screen()).toBe(on ? "loading" : "closed: #2 #3");
      await p.land("issues:open", [{ id: 1 }, { id: 4 }]);
      expect(p.screen()).toBe("open: #1 #4");
      expect(p.asks).toEqual([]);
      expect(p.frames).toEqual([
        "loading",
        "open: #1 #3 #4",
        "open: #1 #4",
        "closed: #2 #3",
        ...(on ? ["loading"] : []),
        "open: #1 #4"
      ]);
    });
  }
});
