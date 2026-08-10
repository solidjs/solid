/**
 * loadingValue (memos / writable memos / optimistic memos) and
 * seedLoadingValue (projections / derived stores / optimistic derived stores).
 *
 * Commit #0 semantics: a node born with a loading value is committed from
 * birth. During the first flight it reads as a settled value everywhere —
 * no NotReadyError propagation, no Loading-boundary suspension, no
 * transition holds (loading-class work) — and the window is verdict-quiet:
 * isPending stays false, because commit #0 answers the question by
 * declaration. First-load affordances live in the value channel (null /
 * skeleton provenance); isPending remains refetch truth for an answered
 * question — `data.skeleton || isPending(data)` covers the two disjoint
 * states. The first real answer replaces the loading value and closes the
 * window permanently: refetches use normal pending semantics.
 */
import {
  createEffect,
  createLoadingBoundary,
  createMemo,
  createOptimistic,
  createOptimisticStore,
  createProjection,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  isPending,
  latest,
  NotReadyError,
  resolve
} from "../src/index.js";

afterEach(() => flush());

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise<void>(r => setTimeout(r, 0));

describe("createMemo with loadingValue", () => {
  it("serves the loading value synchronously from birth", () => {
    const d = deferred<string>();
    createRoot(() => {
      const user = createMemo<string>(() => d.promise, { loadingValue: "placeholder" });
      expect(user()).toBe("placeholder");
    });
    flush();
  });

  it("never suspends readers during the first flight (effects run with the loading value)", async () => {
    const d = deferred<string>();
    const log: string[] = [];
    createRoot(() => {
      const user = createMemo<string>(() => d.promise, { loadingValue: "placeholder" });
      createRenderEffect(
        () => user(),
        v => {
          log.push(v);
        }
      );
    });
    flush();
    expect(log).toEqual(["placeholder"]);

    d.resolve("real");
    await tick();
    flush();
    expect(log).toEqual(["placeholder", "real"]);
  });

  it("does not trip a Loading boundary during the first flight", async () => {
    const d = deferred<number>();
    let result: any;
    createRoot(() => {
      const data = createMemo<number>(() => d.promise, { loadingValue: 0 });
      const boundary = createLoadingBoundary(
        () => data(),
        () => "loading"
      );
      createRenderEffect(
        () => (result = boundary()),
        () => {}
      );
    });
    flush();
    expect(result).toBe(0);

    d.resolve(42);
    await tick();
    flush();
    expect(result).toBe(42);
  });

  it("keeps the loading window verdict-quiet: isPending stays false through the first flight", async () => {
    const d = deferred<string>();
    let user!: () => string;
    createRoot(() => {
      user = createMemo<string>(() => d.promise, { loadingValue: "placeholder" });
    });
    flush();
    // Commit #0 answers the question by declaration; first-load affordances
    // belong to the value channel, so the window never reads pending.
    expect(isPending(user)).toBe(false);

    d.resolve("real");
    await tick();
    flush();
    expect(user()).toBe("real");
    expect(isPending(user)).toBe(false);
  });

  it("derived memos read as settled real answers and stay verdict-quiet too", async () => {
    const d = deferred<{ name: string }>();
    let user!: () => { name: string };
    let label!: () => string;
    createRoot(() => {
      user = createMemo<{ name: string }>(() => d.promise, {
        loadingValue: { name: "..." }
      });
      label = createMemo(() => `name:${user().name}`);
    });
    flush();
    // The derived memo computes a real answer from commit #0.
    expect(label()).toBe("name:...");
    // The whole window is quiet — source, direct expression, and derivation
    // alike. Loading provenance at any distance is the data's job (e.g. a
    // skeleton flag), by design.
    expect(isPending(user)).toBe(false);
    expect(isPending(() => user().name)).toBe(false);
    expect(isPending(label)).toBe(false);

    d.resolve({ name: "Ada" });
    await tick();
    flush();
    expect(label()).toBe("name:Ada");
    expect(isPending(user)).toBe(false);
  });

  it("uses the loading value as the compute's first prev", async () => {
    const d = deferred<number>();
    const prevs: number[] = [];
    let total!: () => number;
    createRoot(() => {
      total = createMemo<number>(
        prev => {
          prevs.push(prev);
          return d.promise.then(n => prev + n);
        },
        { loadingValue: 100 }
      );
    });
    flush();
    expect(prevs).toEqual([100]);

    d.resolve(5);
    await tick();
    flush();
    expect(total()).toBe(105);
  });

  it("closes the window permanently: refetches use normal pending semantics", async () => {
    const d1 = deferred<string>();
    const d2 = deferred<string>();
    let setId!: (v: number) => void;
    let user!: () => string;
    const reads: string[] = [];
    createRoot(() => {
      const [id, set] = createSignal(1);
      setId = set;
      user = createMemo<string>(() => (id() === 1 ? d1.promise : d2.promise), {
        loadingValue: "placeholder"
      });
      createRenderEffect(
        () => user(),
        v => {
          reads.push(v);
        }
      );
    });
    flush();
    d1.resolve("first");
    await tick();
    flush();
    expect(reads).toEqual(["placeholder", "first"]);

    setId(2);
    flush();
    // Refetch: the loading value must NOT reappear; tracked reads suspend
    // (normal pending), the effect keeps showing the stale committed value.
    expect(reads).toEqual(["placeholder", "first"]);
    expect(latest(user)).toBe("first");
    expect(isPending(user)).toBe(true);
    expect(() =>
      createRoot(() => {
        createMemo(() => user())();
      })
    ).toThrow(NotReadyError);

    d2.resolve("second");
    await tick();
    flush();
    expect(reads).toEqual(["placeholder", "first", "second"]);
    expect(isPending(user)).toBe(false);
  });

  it("lands a synchronous first answer immediately and closes the window", async () => {
    const d = deferred<string>();
    let setAsync!: (v: boolean) => void;
    let value!: () => string;
    createRoot(() => {
      const [isAsync, set] = createSignal(false);
      setAsync = set;
      value = createMemo<string>(() => (isAsync() ? d.promise : "sync"), {
        loadingValue: "placeholder"
      });
    });
    flush();
    // Sync return IS the first answer — the loading value never shows.
    expect(value()).toBe("sync");
    expect(isPending(value)).toBe(false);

    setAsync(true);
    flush();
    // Window already closed: this is a normal refetch, not a loading window.
    expect(isPending(value)).toBe(true);
    expect(latest(value)).toBe("sync");
    expect(() =>
      createRoot(() => {
        createMemo(() => value())();
      })
    ).toThrow(NotReadyError);
    d.resolve("async");
    await tick();
    flush();
    expect(value()).toBe("async");
  });

  it("propagates a first-flight rejection as an error and reads not-pending while errored", async () => {
    const d = deferred<string>();
    const errors: unknown[] = [];
    let user!: () => string;
    createRoot(() => {
      user = createMemo<string>(() => d.promise, { loadingValue: "placeholder" });
      createEffect(() => user(), {
        effect: () => {},
        error: (e: unknown) => {
          errors.push(e);
        }
      });
    });
    flush();
    d.reject(new Error("boom"));
    await tick();
    flush();
    expect(() => untrackedRead(user)).toThrow("boom");
    // The error is the settled answer: not pending.
    expect(isPending(user)).toBe(false);
  });

  it("serves the loading value again on a retry after an error", async () => {
    const d1 = deferred<string>();
    const d2 = deferred<string>();
    let attempt = 0;
    let user!: () => string;
    const reads: string[] = [];
    const errors: unknown[] = [];
    createRoot(() => {
      user = createMemo<string>(() => (++attempt === 1 ? d1.promise : d2.promise), {
        loadingValue: "placeholder"
      });
      // Error arm: the rejection is a real propagated error by design.
      createEffect(() => user(), {
        effect: (v: string) => {
          reads.push(v);
        },
        error: (e: unknown) => {
          errors.push(e);
        }
      });
    });
    flush();
    expect(reads).toEqual(["placeholder"]);
    d1.reject(new Error("boom"));
    await tick();
    flush();
    expect(errors.length).toBe(1);

    // A tracked re-read on a later cycle retries the errored source; the
    // retry re-opens serving of commit #0 (the answer still hasn't landed).
    let observed: string | undefined;
    createRoot(() => {
      const probe = createMemo(() => user());
      observed = probe();
    });
    flush();
    expect(observed).toBe("placeholder");
    expect(isPending(user)).toBe(false);

    d2.resolve("recovered");
    await tick();
    flush();
    expect(user()).toBe("recovered");
    expect(isPending(user)).toBe(false);
  });

  it("drops superseded first-flight results and keeps serving until the live flight lands", async () => {
    const d1 = deferred<string>();
    const d2 = deferred<string>();
    let setId!: (v: number) => void;
    let user!: () => string;
    const reads: string[] = [];
    createRoot(() => {
      const [id, set] = createSignal(1);
      setId = set;
      user = createMemo<string>(() => (id() === 1 ? d1.promise : d2.promise), {
        loadingValue: "placeholder"
      });
      createRenderEffect(
        () => user(),
        v => {
          reads.push(v);
        }
      );
    });
    flush();
    setId(2); // supersede mid-first-flight
    flush();
    expect(reads).toEqual(["placeholder"]);
    expect(isPending(user)).toBe(false); // still the loading window: quiet

    d1.resolve("stale"); // dead flight: must be dropped
    await tick();
    flush();
    expect(reads).toEqual(["placeholder"]);
    expect(user()).toBe("placeholder");

    d2.resolve("fresh");
    await tick();
    flush();
    expect(reads).toEqual(["placeholder", "fresh"]);
    expect(isPending(user)).toBe(false);
  });

  it("keeps serving while a sync dependency is unready and retries when it settles", async () => {
    const d = deferred<number>();
    let out!: () => string;
    const reads: string[] = [];
    createRoot(() => {
      // A plain async memo with no loading value of its own: uninitialized.
      const dep = createMemo(() => d.promise);
      // The loading memo reads it synchronously — the NotReadyError from dep
      // must not surface; commit #0 keeps serving.
      out = createMemo<string>(() => `dep:${dep()}`, { loadingValue: "waiting" });
      createRenderEffect(
        () => out(),
        v => {
          reads.push(v);
        }
      );
    });
    flush();
    expect(reads).toEqual(["waiting"]);
    expect(isPending(out)).toBe(false);

    d.resolve(7);
    await tick();
    flush();
    expect(reads).toEqual(["waiting", "dep:7"]);
    expect(isPending(out)).toBe(false);
  });

  it("supports async iterators: serves until the first yield, then streams normally", async () => {
    let push!: (v: string) => void;
    let done!: () => void;
    const queue: string[] = [];
    let notify: (() => void) | null = null;
    let closed = false;
    async function* source() {
      while (true) {
        if (queue.length) {
          yield queue.shift()!;
        } else if (closed) {
          return;
        } else {
          await new Promise<void>(r => (notify = r));
        }
      }
    }
    push = v => {
      queue.push(v);
      notify?.();
      notify = null;
    };
    done = () => {
      closed = true;
      notify?.();
      notify = null;
    };

    const reads: string[] = [];
    createRoot(() => {
      const feed = createMemo<string>(() => source(), { loadingValue: "empty" });
      createRenderEffect(
        () => feed(),
        v => {
          reads.push(v);
        }
      );
    });
    flush();
    expect(reads).toEqual(["empty"]);

    push("a");
    await tick();
    flush();
    expect(reads).toEqual(["empty", "a"]);

    push("b");
    await tick();
    flush();
    expect(reads).toEqual(["empty", "a", "b"]);
    done();
  });

  it("closes the window without notifying subscribers when the landing equals the loading value", async () => {
    const d = deferred<number>();
    let count!: () => number;
    let runs = 0;
    createRoot(() => {
      count = createMemo<number>(() => d.promise, { loadingValue: 0 });
      createRenderEffect(
        () => count(),
        () => {
          runs++;
        }
      );
    });
    flush();
    expect(runs).toBe(1);
    expect(isPending(count)).toBe(false);

    d.resolve(0); // equal to commit #0
    await tick();
    flush();
    expect(runs).toBe(1); // no value change, no re-run
    expect(isPending(count)).toBe(false);
  });

  it("treats an explicit undefined loading value as a real commit #0", () => {
    const d = deferred<string>();
    createRoot(() => {
      const user = createMemo<string | undefined>(() => d.promise, {
        loadingValue: undefined
      });
      expect(user()).toBe(undefined);
      expect(isPending(user)).toBe(false);
    });
    flush();
  });

  it("resolve() returns the loading value: commit #0 is a settled answer", async () => {
    const d = deferred<string>();
    let user!: () => string;
    createRoot(() => {
      user = createMemo<string>(() => d.promise, { loadingValue: "placeholder" });
    });
    flush();
    await expect(resolve(() => user())).resolves.toBe("placeholder");
    d.resolve("real");
  });

  it("latest() serves the loading value during the first flight", () => {
    const d = deferred<string>();
    createRoot(() => {
      const user = createMemo<string>(() => d.promise, { loadingValue: "placeholder" });
      expect(latest(user)).toBe("placeholder");
    });
    flush();
  });
});

describe("writable forms with loadingValue", () => {
  it("createSignal(fn): manual writes layer over the loading window; the landing still arrives", async () => {
    const d = deferred<string>();
    let user!: () => string;
    let setUser!: (v: string) => void;
    createRoot(() => {
      [user, setUser] = createSignal<string>(() => d.promise, { loadingValue: "placeholder" });
    });
    flush();
    expect(user()).toBe("placeholder");
    expect(isPending(user)).toBe(false);

    setUser("draft");
    flush();
    expect(user()).toBe("draft");
    // The compute's flight is still open, but the window stays quiet — the
    // manual write is just another committed answer inside it.
    expect(isPending(user)).toBe(false);

    d.resolve("real");
    await tick();
    flush();
    expect(user()).toBe("real");
    expect(isPending(user)).toBe(false);
  });

  it("createOptimistic(fn): serves the loading value and reverts writes on landing", async () => {
    const d = deferred<string>();
    let user!: () => string;
    createRoot(() => {
      [user] = createOptimistic<string>(() => d.promise, { loadingValue: "placeholder" });
    });
    flush();
    expect(user()).toBe("placeholder");
    expect(isPending(user)).toBe(false);

    d.resolve("real");
    await tick();
    flush();
    expect(user()).toBe("real");
    expect(isPending(user)).toBe(false);
  });
});

describe("projections with seedLoadingValue", () => {
  it("control: without seedLoadingValue, first-flight reads suspend", () => {
    const d = deferred<void>();
    createRoot(() => {
      const proj = createProjection<{ value: number }>(
        async draft => {
          await d.promise;
          draft.value = 1;
        },
        { value: 0 }
      );
      expect(() =>
        createRoot(() => {
          createMemo(() => proj.value)();
        })
      ).toThrow(NotReadyError);
    });
    flush();
    d.resolve();
  });

  it("serves the seed during the first flight and reconciles the landing", async () => {
    const d = deferred<void>();
    const reads: number[] = [];
    let proj!: { value: number };
    createRoot(() => {
      proj = createProjection<{ value: number }>(
        async draft => {
          await d.promise;
          draft.value = 1;
        },
        { value: 0 },
        { seedLoadingValue: true }
      );
      createRenderEffect(
        () => proj.value,
        v => {
          reads.push(v);
        }
      );
    });
    flush();
    expect(reads).toEqual([0]);
    expect(isPending(() => proj.value)).toBe(false);

    d.resolve();
    await tick();
    flush();
    expect(reads).toEqual([0, 1]);
    expect(isPending(() => proj.value)).toBe(false);
  });

  it("does not trip a Loading boundary during the first flight", async () => {
    const d = deferred<void>();
    let result: any;
    createRoot(() => {
      const proj = createProjection<{ items: string[] }>(
        async draft => {
          await d.promise;
          draft.items = ["a", "b"];
        },
        { items: [] },
        { seedLoadingValue: true }
      );
      const boundary = createLoadingBoundary(
        () => proj.items.length,
        () => "loading"
      );
      createRenderEffect(
        () => (result = boundary()),
        () => {}
      );
    });
    flush();
    expect(result).toBe(0);

    d.resolve();
    await tick();
    flush();
    expect(result).toBe(2);
  });

  it("closes the window permanently: projection refetches suspend normally", async () => {
    const d1 = deferred<void>();
    const d2 = deferred<void>();
    let setId!: (v: number) => void;
    let proj!: { value: string };
    const reads: string[] = [];
    createRoot(() => {
      const [id, set] = createSignal(1);
      setId = set;
      proj = createProjection<{ value: string }>(
        async draft => {
          const current = id();
          await (current === 1 ? d1.promise : d2.promise);
          draft.value = `v${current}`;
        },
        { value: "seed" },
        { seedLoadingValue: true }
      );
      createRenderEffect(
        () => proj.value,
        v => {
          reads.push(v);
        }
      );
    });
    flush();
    expect(reads).toEqual(["seed"]);
    d1.resolve();
    await tick();
    flush();
    expect(reads).toEqual(["seed", "v1"]);

    setId(2);
    flush();
    // Normal refetch: tracked reads suspend; the seed never reappears.
    expect(reads).toEqual(["seed", "v1"]);
    expect(() =>
      createRoot(() => {
        createMemo(() => proj.value)();
      })
    ).toThrow(NotReadyError);
    expect(isPending(() => proj.value)).toBe(true);

    d2.resolve();
    await tick();
    flush();
    expect(reads).toEqual(["seed", "v1", "v2"]);
  });

  it("createStore(fn, seed, { seedLoadingValue }): derived writable store serves the seed", async () => {
    const d = deferred<void>();
    let store!: { count: number };
    let setStore!: (fn: (s: { count: number }) => void) => void;
    createRoot(() => {
      [store, setStore] = createStore<{ count: number }>(
        async draft => {
          await d.promise;
          draft.count = 10;
        },
        { count: 0 },
        { seedLoadingValue: true }
      );
    });
    flush();
    expect(store.count).toBe(0);
    expect(isPending(() => store.count)).toBe(false);

    d.resolve();
    await tick();
    flush();
    expect(store.count).toBe(10);
    expect(isPending(() => store.count)).toBe(false);

    setStore(s => {
      s.count = 11;
    });
    flush();
    expect(store.count).toBe(11);
  });

  it("createOptimisticStore(fn, seed, { seedLoadingValue }): serves the seed until landing", async () => {
    const d = deferred<void>();
    let store!: { items: string[] };
    createRoot(() => {
      [store] = createOptimisticStore<{ items: string[] }>(
        async draft => {
          await d.promise;
          draft.items = ["real"];
        },
        { items: ["skeleton"] },
        { seedLoadingValue: true }
      );
    });
    flush();
    expect(store.items).toEqual(["skeleton"]);
    expect(isPending(() => store.items.length)).toBe(false);

    d.resolve();
    await tick();
    flush();
    expect(store.items).toEqual(["real"]);
    expect(isPending(() => store.items.length)).toBe(false);
  });
});

// Reads a memo outside any owner/tracking scope, rethrowing its settled error.
function untrackedRead<T>(fn: () => T): T {
  return fn();
}
