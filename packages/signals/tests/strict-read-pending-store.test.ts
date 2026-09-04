import { describe, expect, it, vi } from "vitest";
import {
  createMemo,
  createOptimisticStore,
  createRoot,
  createStore,
  DEV,
  flush,
  isPending,
  refresh,
  untrack
} from "../src/index.js";
import { NotReadyError } from "../src/core/error.js";

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/**
 * #2897: a derived store's seed is a draft for the derive function, never an
 * observable value. Until the firewall first resolves, ANY consumer read
 * throws NotReady (memo parity — returning the seed leaked it; returning
 * undefined would break non-nullable types). In dev strictRead scopes
 * (component bodies), the PENDING_ASYNC_UNTRACKED_READ error wins first,
 * exactly as it does for memos. Once initialized, untracked reads flow the
 * committed value; refetch windows keep the dev safeguard.
 */
describe("uninitialized derived stores never leak the seed (#2897)", () => {
  it("memo control: uninitialized async memo read in a component body throws the dev error", async () => {
    createRoot(() => {
      const a = createMemo(async () => {
        await wait(10);
        return 2;
      });
      flush();
      untrack(() => {
        expect(() => a()).toThrow("[PENDING_ASYNC_UNTRACKED_READ]");
      }, "App");
    });
    await wait(20);
    flush();
  });

  it("memo control: uninitialized async memo read in a plain untrack throws NotReady", async () => {
    createRoot(() => {
      const a = createMemo(async () => {
        await wait(10);
        return 2;
      });
      flush();
      let caught: any = null;
      try {
        untrack(() => a());
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(NotReadyError);
    });
    await wait(20);
    flush();
  });

  it("optimistic store: component-body read while uninitialized throws the dev error", async () => {
    createRoot(() => {
      const [s] = createOptimisticStore<{ a?: number }>(
        async () => {
          await wait(10);
          return {};
        },
        { a: 1 }
      );
      flush();
      untrack(() => {
        expect(() => s.a).toThrow("[PENDING_ASYNC_UNTRACKED_READ]");
      }, "App");
    });
    await wait(20);
    flush();
  });

  it("optimistic store: plain untracked read while uninitialized throws NotReady (prod path)", async () => {
    createRoot(() => {
      const [s] = createOptimisticStore<{ a?: number }>(
        async () => {
          await wait(10);
          return {};
        },
        { a: 1 }
      );
      flush();
      let caught: any = null;
      try {
        untrack(() => s.a);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(NotReadyError);
    });
    await wait(20);
    flush();
  });

  it("plain derived store: seed structure is invisible untracked ('in', keys, values)", async () => {
    createRoot(() => {
      const [s] = createStore<{ a?: number }>(
        async () => {
          await wait(10);
          return {};
        },
        { a: 1 }
      );
      flush();
      untrack(() => {
        expect(() => s.a).toThrow(NotReadyError);
        expect(() => "a" in s).toThrow(NotReadyError);
        expect(() => Object.keys(s)).toThrow(NotReadyError);
        expect(() => ({ ...s })).toThrow(NotReadyError);
      });
    });
    await wait(20);
    flush();
  });

  it("after first resolution, untracked reads flow the committed value", async () => {
    let read!: () => number | undefined;
    createRoot(() => {
      const [s] = createOptimisticStore<{ a?: number }>(
        async () => {
          await wait(5);
          return { a: 2 };
        },
        { a: 1 }
      );
      read = () => untrack(() => s.a);
    });
    flush();
    await wait(20);
    flush();
    expect(read()).toBe(2);
  });

  it("refetch window (initialized + pending): committed value untracked, dev error in component body", async () => {
    let s!: { a?: number };
    createRoot(() => {
      [s] = createOptimisticStore<{ a?: number }>(
        async () => {
          await wait(5);
          return { a: 2 };
        },
        { a: 1 }
      );
    });
    flush();
    await wait(20);
    flush();
    refresh(s as any);
    flush();
    // initialized: plain untracked read returns the committed value
    expect(untrack(() => s.a)).toBe(2);
    // but a component body still gets the loud dev safeguard
    untrack(() => {
      expect(() => s.a).toThrow("[PENDING_ASYNC_UNTRACKED_READ]");
    }, "App");
    await wait(20);
    flush();
    expect(untrack(() => s.a)).toBe(2);
  });

  /**
   * #2928: the dev safeguard above must NOT fire inside an isPending() probe.
   * Its plain Error is swallowed by the probe's catch (which only rethrows
   * NotReadyError), so dev returned `false` where prod propagated NotReady —
   * a dev/prod divergence. Probe reads follow the prod path in both builds:
   * uninitialized + surrounding context ⇒ NotReadyError propagates (A16/B5a).
   */
  it("isPending on an uninitialized derived store in a component body throws NotReady in dev too (#2928)", async () => {
    createRoot(() => {
      const [s] = createOptimisticStore<{ a?: number }>(
        async () => {
          await wait(10);
          return {};
        },
        { a: 1 }
      );
      flush();
      untrack(() => {
        let caught: any = null;
        try {
          isPending(() => s.a);
        } catch (e) {
          caught = e;
        }
        expect(caught).toBeInstanceOf(NotReadyError);
      }, "App");
    });
    await wait(20);
    flush();
  });

  it("isPending on an uninitialized async memo in a component body throws NotReady in dev too (#2928)", async () => {
    createRoot(() => {
      const a = createMemo(async () => {
        await wait(10);
        return 2;
      });
      flush();
      untrack(() => {
        let caught: any = null;
        try {
          isPending(() => a());
        } catch (e) {
          caught = e;
        }
        expect(caught).toBeInstanceOf(NotReadyError);
      }, "App");
    });
    await wait(20);
    flush();
  });

  it("isPending stays a plain boolean fully untracked, even under a strictRead label (#2928)", async () => {
    const [s] = createOptimisticStore<{ a?: number }>(
      async () => {
        await wait(10);
        return {};
      },
      { a: 1 }
    );
    flush();
    // No surrounding context: A16 — isPending never throws untracked.
    untrack(() => {
      expect(isPending(() => s.a)).toBe(false);
    }, "App");
    await wait(20);
    flush();
  });

  it("plain (non-derived) store reads are unaffected", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    createRoot(() => {
      const [s] = createStore<{ a: number }>({ a: 1 });
      untrack(() => {
        expect(s.a).toBe(1);
        expect("a" in s).toBe(true);
        expect(Object.keys(s)).toEqual(["a"]);
      }, "App");
    });
    warn.mockRestore();
  });
});

/**
 * Resolving a promise with a store proxy makes the engine read `.then` to
 * decide whether the value is a thenable. The read goes through the store's
 * get trap synchronously, in whatever scope the resolution happens — so
 * refresh(store)'s waiter callback (an "effect callback" strict-read scope),
 * `Promise.resolve(store)` in a component body, or `return store` from an
 * async function all probe `.then` under a strict-read label. The probe is
 * not a read the user wrote: it must neither warn (STRICT_READ_UNTRACKED)
 * nor escalate to the pending throw (PENDING_ASYNC_UNTRACKED_READ), which
 * would reject the promise being resolved.
 */
describe("thenable probe on a store proxy in a strict-read scope", () => {
  it("await refresh(store) on a derived store emits no strict-read diagnostic", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const capture = DEV!.diagnostics.capture();
    let fetches = 0;
    let dispose!: () => void;
    let list!: { id: number }[];
    createRoot(d => {
      dispose = d;
      [list] = createStore(
        async () => {
          fetches++;
          await wait(5);
          return [{ id: fetches }];
        },
        [] as { id: number }[]
      );
    });
    flush();
    await wait(20);
    flush();
    expect(fetches).toBe(1);

    const delivered = await refresh(list);
    flush();

    expect(delivered).toBe(list);
    expect(fetches).toBe(2);
    const events = capture.stop();
    expect(events.filter(e => e.code === "STRICT_READ_UNTRACKED")).toEqual([]);
    expect(events.filter(e => e.code === "PENDING_ASYNC_UNTRACKED_READ")).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
    dispose();
  });

  it("Promise.resolve(store) in a component body neither warns nor rejects", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const capture = DEV!.diagnostics.capture();
    let dispose!: () => void;
    let p!: Promise<unknown>;
    let control!: number;
    createRoot(d => {
      dispose = d;
      const [store] = createStore({ count: 1 });
      untrack(() => {
        p = Promise.resolve(store);
        // Control: a real untracked read still warns.
        control = store.count;
      }, "App");
    });
    await expect(p).resolves.toEqual({ count: 1 });
    expect(control).toBe(1);
    const events = capture.stop();
    const strict = events.filter(e => e.code === "STRICT_READ_UNTRACKED");
    expect(strict).toHaveLength(1);
    expect(strict[0].data?.property).toBe("count");
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    dispose();
  });

  it("thenable probe on a refetching derived store does not throw the pending error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const capture = DEV!.diagnostics.capture();
    let dispose!: () => void;
    let list!: { id: number }[];
    let fetches = 0;
    createRoot(d => {
      dispose = d;
      [list] = createStore(
        async () => {
          fetches++;
          await wait(5);
          return [{ id: fetches }];
        },
        [] as { id: number }[]
      );
    });
    flush();
    await wait(20);
    flush();

    // A component-body probe while the store is REFETCHING must still be a
    // no-op — the pending escalation would reject the promise.
    const first = refresh(list);
    let p!: Promise<unknown>;
    untrack(() => {
      p = Promise.resolve(list);
    }, "App");
    await expect(p).resolves.toBe(list);
    await first;
    flush();
    const events = capture.stop();
    expect(events.filter(e => e.code === "PENDING_ASYNC_UNTRACKED_READ")).toEqual([]);
    expect(events.filter(e => e.code === "STRICT_READ_UNTRACKED")).toEqual([]);
    warn.mockRestore();
    dispose();
  });
});
