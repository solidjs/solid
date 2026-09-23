import {
  action,
  createEffect,
  createProjection,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  isPending,
  onCleanup
} from "../src/index.js";

// #3585 — a projection draft is valid until it is SUPERSEDED (the next run of
// the derive starts) or its owner is DISPOSED (proj R37). Before this ruling
// the gate was "until no longer in flight": a sync derive's draft died the
// instant the function returned, so a subscription set up inside the derive
// could never write through it (GabbeV's first case) — unless the derive
// returned a never-resolving Promise to keep the flight "open" (his second).
// Worse, the old predicate (`owner._x?._inFlight === result`) compared an
// `undefined` result against a missing `_x` extension, so whether a late write
// landed flipped on whether anything had READ the projection yet.
//
// A late write (after the run returned, outside any flight continuation)
// takes the store's authoritative override channel and arms the flush itself
// when no landing will: `schedule()` withholds its microtask under
// projectionWriteActive because a flight's landing normally drains those
// writes, and a mid-continuation drain would tear a landing's pre- and
// post-await halves apart (createProjection.async "notifies only changed
// paths", spec A22).

/** A tiny external data source: per-id subscriber lists you can push to. */
function makeFeed() {
  const subs = new Map<number, Set<(item: number) => void>>();
  let unsubscribes = 0;
  return {
    subscribe(id: number, cb: (item: number) => void) {
      let set = subs.get(id);
      if (!set) subs.set(id, (set = new Set()));
      set.add(cb);
      return () => {
        unsubscribes++;
        set!.delete(cb);
      };
    },
    emit(id: number, item: number) {
      subs.get(id)?.forEach(cb => cb(item));
    },
    get unsubscribes() {
      return unsubscribes;
    },
    listeners(id: number) {
      return subs.get(id)?.size ?? 0;
    }
  };
}

const tick = () => new Promise<void>(r => queueMicrotask(r));

describe("#3585 draft lifetime: valid until superseded or disposed", () => {
  describe("GabbeV's cases (issue text verbatim)", () => {
    it("sync derive: a subscription set up in the derive writes through the draft after it returned", async () => {
      const feed = makeFeed();
      const subscribeToData = feed.subscribe;
      const [id, setId] = createSignal(1);
      const props = {
        get id() {
          return id();
        }
      };
      const seen: number[][] = [];
      let data!: number[];
      const dispose = createRoot(dispose => {
        data = createProjection<number[]>(draft => {
          draft.length = 0;
          const unsubscribe = subscribeToData(props.id, item => {
            draft.push(item);
          });
          onCleanup(unsubscribe);
        }, []);
        createEffect(
          () => [...data],
          v => {
            seen.push(v);
          }
        );
        return dispose;
      });
      flush();
      expect(seen).toEqual([[]]);

      // The derive has returned. Its draft is still live: the push lands and
      // the effect sees it WITHOUT an explicit flush (the late write arms the
      // microtask drain itself).
      feed.emit(1, 10);
      expect(data.length).toBe(1);
      await tick();
      expect(seen).toEqual([[], [10]]);

      feed.emit(1, 11);
      await tick();
      expect(seen).toEqual([[], [10], [10, 11]]);
      expect([...data]).toEqual([10, 11]);

      // "Once props.id update and the projection re run the draft should
      // still be invalidated." — the rerun supersedes run #1's draft: the old
      // subscription is cleaned up (onCleanup), and even if it were still
      // firing, its writes would be dropped (see the supersession block).
      setId(2);
      flush();
      expect(feed.unsubscribes).toBe(1);
      expect(feed.listeners(1)).toBe(0);
      expect(seen.at(-1)).toEqual([]);
      feed.emit(2, 20);
      await tick();
      expect([...data]).toEqual([20]);
      expect(seen.at(-1)).toEqual([20]);
      dispose();
    });

    it("the never-resolving-Promise workaround keeps applying late writes (no regression)", () => {
      // GabbeV's second snippet. NOTE: a projection whose first run never
      // settles is STATUS_UNINITIALIZED for life (proj R23 — every read throws
      // NotReadyError), so the workaround only ever "worked" on a store that
      // had already landed a value. It is now redundant with the plain form
      // above; this pins that it did not regress for the writes themselves.
      const feed = makeFeed();
      const subscribeToData = feed.subscribe;
      const [id, setId] = createSignal(1);
      const props = {
        get id() {
          return id();
        }
      };
      let data!: number[];
      const dispose = createRoot(dispose => {
        data = createProjection<number[]>(draft => {
          draft.length = 0;
          const unsubscribe = subscribeToData(props.id, item => {
            draft.push(item);
          });
          onCleanup(unsubscribe);
          if (props.id === 1) return; // first run lands synchronously
          return new Promise(() => {
            /* never resolves */
          });
        }, []);
        return dispose;
      });
      flush();
      feed.emit(1, 10);
      flush();
      expect([...data]).toEqual([10]);

      setId(2);
      flush();
      feed.emit(2, 20);
      flush();
      expect(feed.unsubscribes).toBe(1);
      expect([...data]).toEqual([20]);
      dispose();
    });
  });

  describe("the old gate was timing-dependent — outcomes no longer change with reads or flushes", () => {
    function scenario(opts: { subscriber: boolean; flushBefore: boolean; returnDraft: boolean }) {
      let late!: () => void;
      let proj!: number[];
      let runs = 0;
      const dispose = createRoot(dispose => {
        proj = createProjection<number[]>(draft => {
          late = () => draft.push(1);
          if (opts.returnDraft) return draft;
        }, []);
        if (opts.subscriber) {
          createRenderEffect(
            () => proj.length,
            () => {
              runs++;
            }
          );
        }
        return dispose;
      });
      if (opts.flushBefore) flush();
      late();
      flush();
      const result = { length: proj.length, runs };
      dispose();
      return result;
    }

    it("with or without a subscriber having read the projection", () => {
      // Old code: `owner._x` was only installed once something read the
      // projection through the firewall, and `undefined === undefined` made
      // the dead draft live only in the unread case.
      expect(scenario({ subscriber: false, flushBefore: true, returnDraft: false }).length).toBe(1);
      const withSub = scenario({ subscriber: true, flushBefore: true, returnDraft: false });
      expect(withSub.length).toBe(1);
      expect(withSub.runs).toBe(2);
    });

    it("with or without a flush between the run and the late write", () => {
      expect(scenario({ subscriber: true, flushBefore: false, returnDraft: false }).length).toBe(1);
      expect(scenario({ subscriber: true, flushBefore: true, returnDraft: false }).length).toBe(1);
    });

    it("whether the derive returned undefined or the draft itself", () => {
      // `return draft` made `result` an object, which never equalled the
      // `null` _inFlight — the same write was dropped for that spelling alone.
      expect(scenario({ subscriber: true, flushBefore: true, returnDraft: true }).length).toBe(1);
      expect(scenario({ subscriber: false, flushBefore: true, returnDraft: true }).length).toBe(1);
    });
  });

  describe("supersession", () => {
    it("a write from run N's continuation after run N+1 started is dropped; run N+1's draft is live", () => {
      const [id, setId] = createSignal(1);
      const lates: Array<(v: number) => void> = [];
      let proj!: { run: number; items: number[] };
      const dispose = createRoot(dispose => {
        proj = createProjection<{ run: number; items: number[] }>(
          draft => {
            const run = id();
            draft.run = run;
            draft.items = [];
            lates.push(v => draft.items.push(v));
          },
          { run: 0, items: [] }
        );
        return dispose;
      });
      flush();
      lates[0](1);
      flush();
      expect(proj.items).toEqual([1]);

      setId(2);
      flush();
      expect(proj.run).toBe(2);
      expect(proj.items).toEqual([]);
      // Run #1's leaked callback: dropped, not applied to run #2's state, and
      // not resurrected anywhere. Silent — the same fate as a superseded
      // async run's pending draft writes (proj R26).
      lates[0](99);
      flush();
      expect(proj.items).toEqual([]);
      // Run #2's callback is the live one.
      lates[1](2);
      flush();
      expect(proj.items).toEqual([2]);
      dispose();
    });

    it("supersession happens when the next run STARTS, even while that run is mid-await", async () => {
      const [id, setId] = createSignal(1);
      const lates: Array<(v: number) => void> = [];
      let release!: () => void;
      let proj!: { run: number; items: number[] };
      const dispose = createRoot(dispose => {
        proj = createProjection<{ run: number; items: number[] }>(
          async draft => {
            const run = id();
            lates.push(v => draft.items.push(v));
            if (run === 1) {
              draft.run = 1;
              draft.items = [];
              return;
            }
            await new Promise<void>(r => (release = r));
            draft.run = run;
            draft.items = [];
          },
          { run: 0, items: [] }
        );
        return dispose;
      });
      flush();
      await tick();
      await tick();
      expect(proj.run).toBe(1);
      lates[0](1);
      flush();
      expect(proj.items).toEqual([1]);

      setId(2);
      flush();
      // Run #2 has started (it is parked on its await). Run #1's draft is dead
      // NOW — not when #2 lands.
      lates[0](99);
      flush();
      release();
      await tick();
      await tick();
      await tick();
      expect(proj.run).toBe(2);
      expect(proj.items).toEqual([]);
      lates[1](2);
      flush();
      expect(proj.items).toEqual([2]);
      dispose();
    });

    it("a run that throws NotReady still supersedes the previous draft", async () => {
      const [id, setId] = createSignal(1);
      const [pending] = createSignal(new Promise<number>(() => {}));
      const lates: Array<(v: number) => void> = [];
      let proj!: { run: number; items: number[] };
      const dispose = createRoot(dispose => {
        proj = createProjection<{ run: number; items: number[] }>(
          draft => {
            const run = id();
            lates.push(v => draft.items.push(v));
            if (run === 2) pending(); // never settles → NotReadyError
            draft.run = run;
            draft.items = [];
          },
          { run: 0, items: [] }
        );
        return dispose;
      });
      flush();
      lates[0](1);
      flush();
      expect(proj.items).toEqual([1]);

      setId(2);
      flush();
      lates[0](99);
      flush();
      // The projection is pending (run #2 threw). Reading it throws; peek at
      // what run #1's dropped write did NOT do by switching back to a
      // settling run.
      setId(3);
      flush();
      expect(proj.run).toBe(3);
      expect(proj.items).toEqual([]);
      dispose();
    });
  });

  describe("disposal", () => {
    it("a write after the owner is disposed is a no-op", async () => {
      const feed = makeFeed();
      const seen: number[] = [];
      let proj!: number[];
      const dispose = createRoot(dispose => {
        proj = createProjection<number[]>(draft => {
          const unsubscribe = feed.subscribe(1, item => {
            draft.push(item);
          });
          onCleanup(unsubscribe);
        }, []);
        createEffect(
          () => proj.length,
          len => {
            seen.push(len);
          }
        );
        return dispose;
      });
      flush();
      feed.emit(1, 10);
      await tick();
      expect(seen).toEqual([0, 1]);

      dispose();
      expect(feed.unsubscribes).toBe(1);

      // A callback that was NOT cleaned up (a leaked timer, a promise that
      // resolves after unmount): the draft is dead with its owner.
      let captured!: (v: number) => void;
      let proj2!: number[];
      const dispose2 = createRoot(dispose => {
        proj2 = createProjection<number[]>(draft => {
          captured = v => draft.push(v);
        }, []);
        return dispose;
      });
      flush();
      captured(1);
      flush();
      expect([...proj2]).toEqual([1]);
      dispose2();
      captured(2);
      flush();
      await tick();
      expect([...proj2]).toEqual([1]);
    });
  });

  describe("late writes reach subscribers", () => {
    it("without an explicit flush — the late write arms the microtask drain (scheduler was stranded before)", async () => {
      let late!: () => void;
      let proj!: { n: number };
      const seen: number[] = [];
      const dispose = createRoot(dispose => {
        proj = createProjection<{ n: number }>(
          draft => {
            draft.n = 0;
            late = () => {
              draft.n++;
            };
          },
          { n: -1 }
        );
        createEffect(
          () => proj.n,
          n => {
            seen.push(n);
          }
        );
        return dispose;
      });
      flush();
      expect(seen).toEqual([0]);
      late();
      late();
      await tick();
      // Two writes, one drain, one effect run.
      expect(seen).toEqual([0, 2]);
      // And the scheduler is not stranded for UNRELATED work afterwards.
      const [s, setS] = createSignal(0);
      const seenS: number[] = [];
      createRoot(() => createEffect(s, v => void seenS.push(v)));
      await tick();
      expect(seenS).toEqual([0]);
      setS(1);
      await tick();
      expect(seenS).toEqual([0, 1]);
      dispose();
    });

    it("after an async derive has LANDED, a subscription it set up keeps writing (and flushing)", async () => {
      const feed = makeFeed();
      let proj!: number[];
      const seen: number[][] = [];
      const dispose = createRoot(dispose => {
        proj = createProjection<number[]>(async draft => {
          await tick();
          draft.length = 0;
          const unsubscribe = feed.subscribe(1, item => {
            draft.push(item);
          });
          onCleanup(unsubscribe);
        }, []);
        createEffect(
          () => [...proj],
          v => {
            seen.push(v);
          }
        );
        return dispose;
      });
      flush();
      await tick();
      await tick();
      await tick();
      expect(seen).toEqual([[]]);
      feed.emit(1, 10);
      await tick();
      expect(seen).toEqual([[], [10]]);
      dispose();
    });

    it("post-await writes inside a still-pending flight are NOT drained early — they coalesce with the landing", async () => {
      // Guards the scheduler fix from widening: the withheld microtask must
      // stay withheld while the flight is up.
      const [x, setX] = createSignal(1);
      let proj!: { a: number; b: number };
      const seen: Array<[number, number]> = [];
      const dispose = createRoot(dispose => {
        proj = createProjection<{ a: number; b: number }>(
          async draft => {
            const v = x();
            await tick();
            draft.a = v;
            await tick();
            draft.b = v;
          },
          { a: 0, b: 0 }
        );
        createEffect(
          () => [proj.a, proj.b] as [number, number],
          v => {
            seen.push(v);
          }
        );
        return dispose;
      });
      flush();
      for (let i = 0; i < 6; i++) await tick();
      expect(seen).toEqual([[1, 1]]);
      setX(2);
      flush();
      for (let i = 0; i < 6; i++) await tick();
      // Never [2, 1]: the rerun is a transition (proj R31) and its landing
      // reveals both halves together.
      expect(seen).toEqual([
        [1, 1],
        [2, 2]
      ]);
      dispose();
    });

    it("a late write made inside an action is held with that action and commits atomically", async () => {
      let late!: () => void;
      let proj!: { n: number };
      const seen: number[] = [];
      let release!: () => void;
      const dispose = createRoot(dispose => {
        proj = createProjection<{ n: number }>(
          draft => {
            draft.n = 0;
            late = () => {
              draft.n++;
            };
          },
          { n: -1 }
        );
        createEffect(
          () => proj.n,
          n => {
            seen.push(n);
          }
        );
        return dispose;
      });
      flush();
      const act = action(function* () {
        late();
        yield new Promise<void>(r => (release = r));
      });
      let pendingDuring: boolean | undefined;
      createRoot(() => {
        createRenderEffect(
          () => isPending(() => proj.n),
          p => {
            pendingDuring = p;
          }
        );
      });
      flush();
      act();
      await tick();
      flush();
      expect(seen).toEqual([0]);
      expect(pendingDuring).toBe(true);
      release();
      for (let i = 0; i < 6; i++) await tick();
      expect(seen).toEqual([0, 1]);
      expect(pendingDuring).toBe(false);
      dispose();
    });
  });

  describe("other store families", () => {
    it("createStore(fn, seed) — the derived writable store — has the same draft lifetime", async () => {
      let late!: () => void;
      let store!: { n: number };
      const dispose = createRoot(dispose => {
        [store] = createStore<{ n: number }>(
          draft => {
            draft.n = 0;
            late = () => {
              draft.n++;
            };
          },
          { n: -1 }
        );
        return dispose;
      });
      flush();
      late();
      await tick();
      expect(store.n).toBe(1);
      dispose();
      late();
      flush();
      expect(store.n).toBe(1);
    });
  });

  describe("seedLoadingValue carve-out (ruled with proj R37)", () => {
    it("a loading-window run works a detached shadow; a late write to it after the first commit is lost", async () => {
      // The one place the one-draft-per-run model does not hold: in the open
      // loading window the derive receives a detached clone of the seed (the
      // observable store IS commit #0, #2988). A callback closing over that
      // clone writes into a dead object once the window has closed. Pinned so
      // a future redirecting shadow flips this test consciously.
      let late!: () => void;
      let proj!: { n: number };
      const dispose = createRoot(dispose => {
        proj = createProjection<{ n: number }>(
          async draft => {
            late = () => {
              draft.n++;
            };
            await tick();
            draft.n = 1;
          },
          { n: 0 },
          { seedLoadingValue: true }
        );
        return dispose;
      });
      flush();
      expect(proj.n).toBe(0);
      for (let i = 0; i < 4; i++) await tick();
      expect(proj.n).toBe(1);
      late();
      flush();
      await tick();
      expect(proj.n).toBe(1);
      dispose();
    });
  });

  describe("a run's own writes do not strand the scheduler", () => {
    // Pre-existing (on `next` before proj R37), fixed in the same mechanism: a
    // derive run OUTSIDE any flush — a projection created in a top-level
    // createRoot — made schedule() withhold its microtask for its own draft
    // writes (projectionWriteActive), then returned with no landing to drain
    // them. `scheduled` stayed set with no microtask, so every later
    // schedule() early-returned: the root's own effects, and any unrelated
    // effect or write anywhere, waited for an explicit flush().
    it("a sync projection created in a top-level root outside any flush leaves the scheduler armed", async () => {
      let proj!: { x: number };
      const seenX: number[] = [];
      const dispose = createRoot(dispose => {
        proj = createProjection<{ x: number }>(
          draft => {
            draft.x = 1;
          },
          { x: 0 }
        );
        createEffect(
          () => proj.x,
          x => {
            seenX.push(x);
          }
        );
        return dispose;
      });
      // No explicit flush anywhere in this test.
      const [s, setS] = createSignal(0);
      const seenS: number[] = [];
      const dispose2 = createRoot(dispose => {
        createEffect(s, v => void seenS.push(v));
        return dispose;
      });
      await tick();
      expect(seenX).toEqual([1]);
      expect(seenS).toEqual([0]);
      setS(1);
      await tick();
      expect(seenS).toEqual([0, 1]);
      dispose();
      dispose2();
    });

    it("an async projection with a pre-await write, created outside any flush, does not strand unrelated work until its landing", async () => {
      let release!: () => void;
      let proj!: { a: number; b: number };
      const seen: Array<[number, number]> = [];
      const dispose = createRoot(dispose => {
        proj = createProjection<{ a: number; b: number }>(
          async draft => {
            draft.a = 1;
            await new Promise<void>(r => (release = r));
            draft.b = 1;
          },
          { a: 0, b: 0 }
        );
        createEffect(
          () => [proj.a, proj.b] as [number, number],
          v => {
            seen.push(v);
          }
        );
        return dispose;
      });
      const [s, setS] = createSignal(0);
      const seenS: number[] = [];
      const dispose2 = createRoot(dispose => {
        createEffect(s, v => void seenS.push(v));
        return dispose;
      });
      await tick();
      // The flight is still up; unrelated work is not held behind it.
      expect(seenS).toEqual([0]);
      setS(1);
      await tick();
      expect(seenS).toEqual([0, 1]);
      // The projection's first landing still reveals both halves together.
      expect(seen).toEqual([]);
      release();
      for (let i = 0; i < 6; i++) await tick();
      expect(seen).toEqual([[1, 1]]);
      dispose();
      dispose2();
    });
  });
});
