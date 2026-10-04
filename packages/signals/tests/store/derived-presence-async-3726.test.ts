/**
 * #3726 — a presence read (`"length" in store`) on a derived store whose
 * first run returned a pending promise stayed blank after a source write
 * made the derive land synchronously: the landing left the reader's own
 * node unchanged, so no value notification reached it, and the settle walk
 * that releases readers parked on a superseded flight skipped the still
 * uninitialized derive (#3181's uninitialized exemption, core `recompute`).
 *
 * On the hold model (L2) the core already holds, with no store-side patch:
 * a reader of a derive with a flight up is the derive's reader — the pull
 * links it (`pullFamily`, store.ts: "a derive with a flight up is read like a
 * memo with one"), so it is parked on the derive itself, and the derive's
 * first commit (uninitialized → a value) is a value change for every
 * subscriber (`recompute`: `wasUninitialized` → `insertSubs`). The walk's
 * exemption is moot: the readers re-run in the landing's flush, pull the
 * settled derive without linking, and the stale link trims. The same
 * reader under a transaction's hold re-runs as the transaction's work and
 * reveals at its commit — the case PR #3732 left open.
 *
 * Rules: A25 (the seed is a draft, never observable — the readers show
 * nothing until the first landing); A19 exc. 1 (uninitialized is loading,
 * not pending — a verdict probe suspends until the landing); A29 (a node
 * born into the future has no committed value: an untracked read of the
 * held landing throws until the commit).
 */
import { describe, expect, it } from "vitest";
import {
  NotReadyError,
  action,
  createLoadingBoundary,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  isPending,
  untrack,
  type Store
} from "../../src/index.js";

const tick = () => new Promise(r => setTimeout(r, 0));
const microtasks = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe("sync landing after a pending first flight wakes unchanged-node readers (#3726)", () => {
  it("presence read inside a loading boundary shows the landed answer", async () => {
    const [source, setSource] = createSignal<number[] | null>(null);
    let resolve!: (v: number[]) => void;
    let presence = "";
    let sourceState = "";
    createRoot(() => {
      const [store] = createStore<number[]>(() => {
        const s = source();
        if (s) return s;
        return new Promise<number[]>(r => (resolve = r));
      }, []);
      createLoadingBoundary(
        () => {
          createRenderEffect(
            () => ("length" in store ? "present" : "missing"),
            v => {
              presence = v;
            }
          );
          createRenderEffect(
            () => (source() ? "resolved" : "pending"),
            v => {
              sourceState = v;
            }
          );
        },
        () => "fallback"
      );
    });
    flush();
    expect(presence).toBe("");
    expect(sourceState).toBe("pending");

    setSource([1]);
    flush();
    expect(sourceState).toBe("resolved");
    expect(presence).toBe("present");

    resolve([2, 2]);
    await tick();
    flush();
    expect(presence).toBe("present");
  });

  it("readers of presence, length and keys wake when the landing leaves them unchanged", () => {
    const [source, setSource] = createSignal<number[] | null>(null);
    const seen: string[] = [];
    createRoot(() => {
      const [store] = createStore<number[]>(() => {
        const s = source();
        if (s) return s;
        return new Promise<number[]>(() => {});
      }, []);
      createRenderEffect(
        () => (0 in store ? "present" : "missing"),
        v => {
          seen.push(`in:${v}`);
        }
      );
      createRenderEffect(
        () => store.length,
        v => {
          seen.push(`length:${v}`);
        }
      );
      createRenderEffect(
        () => Object.keys(store).length,
        v => {
          seen.push(`keys:${v}`);
        }
      );
    });
    flush();
    expect(seen).toEqual([]);

    setSource([]);
    flush();
    expect(seen.sort()).toEqual(["in:missing", "keys:0", "length:0"]);
  });

  it("a landing held by a transaction keeps the seed invisible until the commit", async () => {
    const [source, setSource] = createSignal<number[] | null>(null);
    let release!: () => void;
    let store!: Store<number[]>;
    createRoot(() => {
      [store] = createStore<number[]>(() => source() ?? new Promise(() => {}), [9, 9, 9]);
    });
    flush();

    const done = action(function* () {
      setSource([1]);
      yield new Promise<void>(r => (release = r));
    })();
    flush();
    expect(() => untrack(() => [...store])).toThrow(NotReadyError);

    release();
    await done;
    await tick();
    flush();
    expect(untrack(() => [...store])).toEqual([1]);
  });
});

describe("#3726 on the hold model — the parked reader is the derive's, woken by its first commit", () => {
  it("the report's sequence: source write and promise resolution in one timer callback, under <Loading>", async () => {
    const [source, setSource] = createSignal<number[] | null>(null);
    let resolve!: (v: number[]) => void;
    let presence = "";
    let sourceState = "";
    let shown: unknown;
    createRoot(() => {
      const [store] = createStore<number[]>(() => {
        const s = source();
        if (s) return s;
        return new Promise<number[]>(r => (resolve = r));
      }, []);
      const boundary = createLoadingBoundary(
        () => {
          createRenderEffect(
            () => ("length" in store ? "present" : "missing"),
            v => {
              presence = v;
            }
          );
          createRenderEffect(
            () => (source() ? "resolved" : "pending"),
            v => {
              sourceState = v;
            }
          );
          return "content";
        },
        () => "fallback"
      );
      createRenderEffect(
        () => boundary(),
        v => {
          shown = v;
        }
      );
    });
    // No manual flush: the scheduler's own microtask, as in the app.
    await microtasks();
    expect(shown).toBe("fallback");
    expect(presence).toBe("");

    // The report's timer callback: the source lands the derive synchronously
    // and the superseded first flight resolves in the same tick.
    await new Promise<void>(r =>
      setTimeout(() => {
        setSource([1]);
        resolve([1]);
        r();
      }, 0)
    );
    await microtasks();
    expect(sourceState).toBe("resolved");
    expect(presence).toBe("present");
    expect(shown).toBe("content");
  });

  it("a verdict reader parked on the first flight wakes at the sync landing", () => {
    const [source, setSource] = createSignal<number[] | null>(null);
    let pending: boolean | undefined;
    let presence = "";
    createRoot(() => {
      const [store] = createStore<number[]>(() => source() ?? new Promise(() => {}), []);
      createRenderEffect(
        () => isPending(() => "length" in store),
        v => {
          pending = v;
        }
      );
      createRenderEffect(
        () => ("length" in store ? "present" : "missing"),
        v => {
          presence = v;
        }
      );
    });
    flush();
    // A19 exc. 1: uninitialized is loading, not pending — the probe
    // suspends with the plain reader; neither has run.
    expect(pending).toBe(undefined);
    expect(presence).toBe("");

    setSource([1]);
    flush();
    expect(pending).toBe(false);
    expect(presence).toBe("present");
  });

  it("a landing held by a transaction: the parked readers reveal at its commit, not before (PR #3732's open case)", async () => {
    const [source, setSource] = createSignal<number[] | null>(null);
    let release!: () => void;
    let store!: Store<number[]>;
    const seen: string[] = [];
    createRoot(() => {
      [store] = createStore<number[]>(() => source() ?? new Promise(() => {}), [9, 9, 9]);
      createRenderEffect(
        () => ("length" in store ? "present" : "missing"),
        v => {
          seen.push(`in:${v}`);
        }
      );
      createRenderEffect(
        () => store.length,
        v => {
          seen.push(`length:${v}`);
        }
      );
    });
    flush();
    expect(seen).toEqual([]);

    const done = action(function* () {
      setSource([1]);
      yield new Promise<void>(r => (release = r));
    })();
    flush();
    // Held: the readers re-ran as the transaction's work; nothing published,
    // the seed still invisible (A25; A29 — born into the future).
    expect(seen).toEqual([]);
    expect(() => untrack(() => [...store])).toThrow(NotReadyError);

    release();
    await done;
    await tick();
    flush();
    expect(untrack(() => [...store])).toEqual([1]);
    expect(seen.sort()).toEqual(["in:present", "length:1"]);
  });

  it("a landing held by a transaction under <Loading>: fallback until the commit, content after", async () => {
    const [source, setSource] = createSignal<number[] | null>(null);
    let release!: () => void;
    let presence = "";
    let shown: unknown;
    createRoot(() => {
      const [store] = createStore<number[]>(() => source() ?? new Promise(() => {}), []);
      const boundary = createLoadingBoundary(
        () => {
          createRenderEffect(
            () => ("length" in store ? "present" : "missing"),
            v => {
              presence = v;
            }
          );
          return "content";
        },
        () => "fallback"
      );
      createRenderEffect(
        () => boundary(),
        v => {
          shown = v;
        }
      );
    });
    flush();
    expect(shown).toBe("fallback");

    const done = action(function* () {
      setSource([1]);
      yield new Promise<void>(r => (release = r));
    })();
    flush();
    expect(shown).toBe("fallback");
    expect(presence).toBe("");

    release();
    await done;
    await tick();
    flush();
    expect(shown).toBe("content");
    expect(presence).toBe("present");
  });
});
