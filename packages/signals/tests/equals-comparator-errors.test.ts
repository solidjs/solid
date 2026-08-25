/**
 * Regression tests for #2837 — errors thrown by a user `equals` comparator.
 *
 * A throwing comparator is an error of that node's computation: it routes
 * through the same status path as a compute-phase throw, so error boundaries
 * contain it. Without a boundary it halts the reactive system loudly
 * (REACTIVITY_HALTED) exactly like an uncaught compute error — never a silent
 * scheduler wedge.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEffect,
  createErrorBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush
} from "../src/index.js";

type User = { id: number };

describe("equals comparator errors (#2837)", () => {
  let errorSpy!: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("sync recompute: boundary contains the comparator throw; scheduler stays alive", () => {
    const log: string[] = [];
    const [users, setUsers] = createSignal<User[]>([{ id: 1 }]);
    const [beat, setBeat] = createSignal(0);

    createRoot(() => {
      createRenderEffect(beat, v => {
        log.push(`beat=${v}`);
      });
      const boundary = createErrorBoundary(
        () => {
          const selected = createMemo(() => users().find(u => u.id === 1), {
            equals: (prev, next) => prev!.id === next!.id
          });
          return `content:${selected()?.id}`;
        },
        err => `fallback:${(err as () => unknown)()}`
      );
      createRenderEffect(boundary, v => {
        log.push(v);
      });
    });
    flush();
    expect(log).toEqual(["beat=0", "content:1"]);
    log.length = 0;

    // Comparator receives undefined and throws mid-flush
    expect(() => {
      setUsers([]);
      flush();
    }).not.toThrow();
    expect(log).toEqual(["fallback:TypeError: Cannot read properties of undefined (reading 'id')"]);
    log.length = 0;

    // The scheduler is not wedged: unrelated updates still flush
    setBeat(1);
    flush();
    expect(log).toEqual(["beat=1"]);
  });

  it("user effect on the errored memo does not fire with a bogus value", () => {
    const values: unknown[] = [];
    const [users, setUsers] = createSignal<User[]>([{ id: 1 }]);

    createRoot(() => {
      createErrorBoundary(
        () => {
          const selected = createMemo(() => users().find(u => u.id === 1), {
            equals: (prev, next) => prev!.id === next!.id
          });
          createEffect(selected, v => {
            values.push(v);
          });
          return selected();
        },
        () => "fallback"
      );
    });
    flush();
    expect(values).toEqual([{ id: 1 }]);

    setUsers([]);
    flush();
    // The comparator threw before any commit: no effect run with undefined
    expect(values).toEqual([{ id: 1 }]);
  });

  it("recovers after the source produces comparable values again", () => {
    const log: string[] = [];
    const [users, setUsers] = createSignal<User[]>([{ id: 1 }]);

    createRoot(() => {
      const boundary = createErrorBoundary(
        () => {
          const selected = createMemo(() => users().find(u => u.id === 1), {
            equals: (prev, next) => prev!.id === next!.id
          });
          return `content:${selected()?.id}`;
        },
        (_err, reset) => {
          log.push("caught");
          queueMicrotask(() => {});
          resetBoundary = reset;
          return "fallback";
        }
      );
      createRenderEffect(boundary, v => {
        log.push(v);
      });
    });
    let resetBoundary!: () => void;
    flush();
    expect(log).toEqual(["content:1"]);
    log.length = 0;

    setUsers([]);
    flush();
    expect(log).toEqual(["caught", "fallback"]);
    log.length = 0;

    setUsers([{ id: 1 }]);
    resetBoundary();
    flush();
    expect(log).toEqual(["content:1"]);
  });

  it("async resolution: comparator throw routes to the boundary, not an unhandled rejection", async () => {
    const log: string[] = [];
    let resolve!: (v: User | undefined) => void;
    let promise = new Promise<User | undefined>(r => (resolve = r));
    const [tick, setTick] = createSignal(0);

    createRoot(() => {
      const boundary = createErrorBoundary(
        () => {
          const selected = createMemo(
            () => {
              tick();
              return promise;
            },
            { equals: (prev, next) => prev!.id === next!.id }
          );
          return createMemo(() => `content:${selected()?.id}`);
        },
        err => createMemo(() => `fallback:${(err as () => unknown)()}`)
      );
      createRenderEffect(
        () => {
          const v = boundary();
          return typeof v === "function" ? v() : v;
        },
        v => {
          log.push(String(v));
        }
      );
    });
    flush();

    resolve({ id: 1 });
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(log.at(-1)).toBe("content:1");

    // Refetch resolves with undefined: the comparator throws inside the
    // promise resolution machinery where no user frame exists to catch it.
    promise = new Promise<User | undefined>(r => (resolve = r));
    setTick(1);
    flush();
    resolve(undefined);
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(log.at(-1)).toBe(
      "fallback:TypeError: Cannot read properties of undefined (reading 'id')"
    );
  });

  it("no boundary: halts loudly through REACTIVITY_HALTED, later writes report ignored", () => {
    const log: string[] = [];
    const [users, setUsers] = createSignal<User[]>([{ id: 1 }]);
    const [beat, setBeat] = createSignal(0);

    createRoot(() => {
      createRenderEffect(beat, v => {
        log.push(`beat=${v}`);
      });
      const selected = createMemo(() => users().find(u => u.id === 1), {
        equals: (prev, next) => prev!.id === next!.id
      });
      createRenderEffect(
        () => `sel=${selected()?.id}`,
        v => {
          log.push(v);
        }
      );
    });
    flush();
    log.length = 0;

    // Uncaught: the error surfaces from the flush and the killswitch engages
    expect(() => {
      setUsers([]);
      flush();
    }).toThrow("Cannot read properties of undefined");
    // The halt log carries the causing error alongside the message (#2884).
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("REACTIVITY_HALTED"),
      expect.objectContaining({
        message: expect.stringContaining("Cannot read properties of undefined")
      })
    );

    // Halted deliberately and loudly — not a silent wedge
    setBeat(1);
    flush();
    expect(log).toEqual([]);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Update ignored"));
  });
});
