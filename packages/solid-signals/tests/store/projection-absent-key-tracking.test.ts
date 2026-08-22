import {
  createEffect,
  createMemo,
  createProjection,
  createRoot,
  createStore,
  flush
} from "../../src/index.js";

/**
 * #3037 — a projection derive runs its whole body inside a store setter
 * (storeSetterNext), so the old GLOBAL `writing` gate suppressed absent-key
 * and accessor-key subscriptions for EVERY store read mid-derive — including
 * external stores that are the derive's dependencies. A nested projection
 * whose sources hadn't materialized yet finished with zero deps and never
 * re-ran (silent, permanent, scheduling-dependent). Tracking suppression must
 * be per-target (inDraft): only the written store's own draft reads skip
 * linking.
 */
describe("projection derives subscribe to external absent keys (#3037)", () => {
  it("re-runs when an absent external key materializes", () => {
    createRoot(() => {
      const [source, setSource] = createStore<{ measured?: { width: number } }>({});
      let runs = 0;
      const proj = createProjection<{ width: number | null }>(
        draft => {
          runs++;
          // `measured` is ABSENT on the first derive — this read must still
          // subscribe even though a setter scope is open around the derive.
          draft.width = source.measured ? source.measured.width : null;
        },
        { width: null }
      );
      const width = createMemo(() => proj.width);
      expect(width()).toBe(null);
      expect(runs).toBe(1);

      setSource(d => {
        d.measured = { width: 42 };
      });
      flush();
      expect(width()).toBe(42);
      expect(runs).toBe(2);
    });
  });

  it("re-runs when another projection's store materializes the key (nested shape)", () => {
    createRoot(() => {
      const [trigger, setTrigger] = createStore<{ ready: boolean }>({ ready: false });
      // Upstream projection: publishes `bounds` only once ready — the key is
      // absent before that, like unmeasured node rows.
      const nodes = createProjection<{ bounds?: { w: number } }>(draft => {
        if (trigger.ready) draft.bounds = { w: 7 };
        else delete draft.bounds;
      }, {});
      // Downstream projection derives FROM the upstream store: its first
      // derive reads the absent `bounds` while its own setter scope is open.
      let runs = 0;
      const edges = createProjection<{ w: number | null }>(
        draft => {
          runs++;
          draft.w = nodes.bounds ? nodes.bounds.w : null;
        },
        { w: null }
      );
      const w = createMemo(() => edges.w);
      expect(w()).toBe(null);
      expect(runs).toBe(1);

      setTrigger(d => {
        d.ready = true;
      });
      flush();
      expect(w()).toBe(7);
      expect(runs).toBeGreaterThanOrEqual(2);
    });
  });

  it("tracks external accessor keys read mid-derive", () => {
    createRoot(() => {
      const [dep, setDep] = createStore({ base: 1 });
      const sourceRaw = {
        get doubled() {
          return dep.base * 2;
        }
      };
      const [source] = createStore(sourceRaw);
      let runs = 0;
      const proj = createProjection<{ value: number }>(
        draft => {
          runs++;
          draft.value = source.doubled;
        },
        { value: 0 }
      );
      const value = createMemo(() => proj.value);
      expect(value()).toBe(2);
      expect(runs).toBe(1);

      setDep(d => {
        d.base = 5;
      });
      flush();
      expect(value()).toBe(10);
      expect(runs).toBe(2);
    });
  });

  it("own-draft absent-key reads still do not self-subscribe", () => {
    createRoot(() => {
      let runs = 0;
      const [source, setSource] = createStore({ tick: 0 });
      const proj = createProjection<{ tick: number; late?: number }>(
        draft => {
          runs++;
          void source.tick;
          // Reading the projection's OWN not-yet-written key must not link the
          // derive to itself (draft reads never self-track, proj R2).
          void draft.late;
          draft.late = runs;
        },
        { tick: 0 }
      );
      createEffect(
        () => proj.late,
        () => {}
      );
      flush();
      const after = runs;
      // A self-subscription would make the write above re-dirty the derive
      // every pass; a single external tick must produce exactly one re-run.
      setSource(d => {
        d.tick = 1;
      });
      flush();
      expect(runs).toBe(after + 1);
    });
  });
});
