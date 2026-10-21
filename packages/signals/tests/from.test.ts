/**
 * `from` — a push source (subscribe function, Observable, AsyncIterable) as
 * an AsyncIterable a computation consumes. Latest-value semantics; the
 * subscription closes on return(), on supersede and on owner disposal.
 *
 * The supersede cases pin the instant the OLD source closes after
 * `setX(); flush()` — synchronously, with no tick — both when the compute
 * returns `from(...)` directly (the engine's iterator teardown slot, #3122)
 * and when `from` is iterated with `for await` inside an async generator
 * (the generator's own return() is queued behind its pending await, and
 * owner cleanups wait for the replacing pass to commit; `from` registers on
 * the supersede hook instead).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEffect,
  createErrorBoundary,
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  createTrackedEffect,
  flush,
  from,
  isPending,
  latest,
  OBSERVE,
  resetErrorHalt
} from "../src/index.js";

afterEach(() => {
  resetErrorHalt();
  flush();
  vi.restoreAllMocks();
});

const microtasks = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
  flush();
};

type Controls<T> = {
  next(value: T): void;
  error(err: unknown): void;
  complete(): void;
};

/** A subscribe function that logs open/close and exposes its observer. */
function source<T>(
  label: string,
  log: string[],
  initial?: { value: T }
): ((next: (v: T) => void, error: (e: unknown) => void, complete: () => void) => () => void) &
  Controls<T> {
  let observer: Controls<T> | null = null;
  const subscribe = (next: (v: T) => void, error: (e: unknown) => void, complete: () => void) => {
    log.push(`open ${label}`);
    observer = { next, error, complete };
    if (initial) next(initial.value);
    return () => {
      log.push(`close ${label}`);
      observer = null;
    };
  };
  return Object.assign(subscribe, {
    next: (v: T) => observer?.next(v),
    error: (e: unknown) => observer?.error(e),
    complete: () => observer?.complete()
  });
}

/** Mounts `m` under a root with a reader effect; returns the values it saw. */
function mount<T>(build: () => () => T) {
  const seen: unknown[] = [];
  let read!: () => T;
  let dispose!: () => void;
  createRoot(d => {
    dispose = d;
    read = build();
    createRenderEffect(
      () => {
        try {
          return latest(read);
        } catch {
          return "<pending>";
        }
      },
      v => void seen.push(v)
    );
  });
  flush();
  return { seen, read: () => read(), dispose };
}

describe("from: basics", () => {
  it("a value emitted during subscribe is readable right after flush (no tick)", () => {
    const log: string[] = [];
    const src = source("a", log, { value: 1 });
    const { seen, read, dispose } = mount(() => createMemo(() => from<number>(src)));
    expect(read()).toBe(1);
    expect(seen).toEqual([1]);
    dispose();
  });

  it("coalesces a burst to the latest value and settles", async () => {
    const log: string[] = [];
    const src = source<number>("a", log);
    let m!: () => number;
    const { seen, dispose } = mount(() => (m = createMemo(() => from<number>(src))));
    expect(seen).toEqual(["<pending>"]);

    src.next(1);
    src.next(2);
    src.next(3);
    await microtasks();
    expect(m()).toBe(3);
    expect(seen).not.toContain(2);
    expect(isPending(() => m())).toBe(false);

    // The consumer always has a pull waiting, so a burst's first value
    // answers it; the values that arrive before the next pull coalesce.
    src.next(4);
    src.next(5);
    src.next(6);
    await microtasks();
    expect(m()).toBe(6);
    expect(seen).not.toContain(5);
    expect(seen).toEqual(["<pending>", 1, 3, 4, 6]);
    expect(isPending(() => m())).toBe(false);
    dispose();
  });

  it("dispose unsubscribes, and later emissions are ignored", async () => {
    const log: string[] = [];
    const src = source("a", log, { value: 1 });
    const { seen, dispose } = mount(() => createMemo(() => from<number>(src)));
    expect(log).toEqual(["open a"]);
    dispose();
    expect(log).toEqual(["open a", "close a"]);
    src.next(2);
    await microtasks();
    expect(seen).toEqual([1]);
    expect(log).toEqual(["open a", "close a"]);
  });

  it("accepts an RxJS-shaped Observable returning { unsubscribe }", async () => {
    const log: string[] = [];
    let observer: { next(v: number): void } | null = null;
    const obs = {
      subscribe(o: { next(v: number): void }) {
        log.push("subscribe");
        observer = o;
        o.next(10);
        return { unsubscribe: () => void log.push("unsubscribe") };
      }
    };
    const { read, dispose } = mount(() => createMemo(() => from<number>(obs)));
    expect(read()).toBe(10);
    observer!.next(11);
    await microtasks();
    expect(read()).toBe(11);
    dispose();
    expect(log).toEqual(["subscribe", "unsubscribe"]);
  });

  it('accepts "@@observable" interop', () => {
    const log: string[] = [];
    const inner = {
      subscribe(o: { next(v: string): void }) {
        o.next("interop");
        return { unsubscribe: () => void log.push("unsubscribe") };
      }
    };
    const interop = { "@@observable": () => inner } as any;
    const { read, dispose } = mount(() => createMemo(() => from<string>(interop)));
    expect(read()).toBe("interop");
    dispose();
    expect(log).toEqual(["unsubscribe"]);
  });

  it("accepts Symbol.observable interop when the symbol is defined", () => {
    const hadSymbol = "observable" in Symbol;
    const prev = (Symbol as any).observable;
    (Symbol as any).observable = Symbol("observable");
    try {
      const log: string[] = [];
      const inner = {
        subscribe(o: { next(v: string): void }) {
          o.next("symbol");
          return { unsubscribe: () => void log.push("unsubscribe") };
        }
      };
      // The outer object's own subscribe must not be the one used.
      const interop = {
        [(Symbol as any).observable]: () => inner,
        subscribe: () => {
          throw new Error("used the wrapper, not the interop target");
        }
      } as any;
      const { read, dispose } = mount(() => createMemo(() => from<string>(interop)));
      expect(read()).toBe("symbol");
      dispose();
      expect(log).toEqual(["unsubscribe"]);
    } finally {
      if (hadSymbol) (Symbol as any).observable = prev;
      else delete (Symbol as any).observable;
    }
  });

  it("wraps an AsyncIterable (a new iterable, opened lazily) and rejects other values", () => {
    let opened = 0;
    const it = {
      [Symbol.asyncIterator]: () => {
        opened++;
        return { next: () => new Promise<IteratorResult<number>>(() => {}) };
      }
    };
    const wrapped = from(it);
    expect(wrapped).not.toBe(it);
    expect(opened).toBe(0);
    wrapped[Symbol.asyncIterator]();
    expect(opened).toBe(1);
    expect(() => from(42 as any)).toThrow(TypeError);
  });

  it("an error reaches createErrorBoundary", async () => {
    const log: string[] = [];
    const src = source("a", log, { value: 1 });
    const shown: unknown[] = [];
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      const m = createMemo(() => from<number>(src));
      const b = createErrorBoundary(
        () => m(),
        err => `caught: ${((err() as any)?.cause ?? err()).message}`
      );
      createRenderEffect(
        () => {
          try {
            return b();
          } catch {
            return "<pending>";
          }
        },
        v => void shown.push(v)
      );
    });
    flush();
    expect(shown).toEqual([1]);

    src.error(new Error("boom"));
    await microtasks();
    expect(shown[shown.length - 1]).toBe("caught: boom");
    expect(log).toEqual(["open a", "close a"]);
    dispose();
    expect(log).toEqual(["open a", "close a"]);
  });

  it("complete during subscribe keeps the value and cleans up once", async () => {
    const log: string[] = [];
    const src = (next: (v: number) => void, _e: unknown, complete: () => void) => {
      log.push("open");
      next(7);
      complete();
      return () => void log.push("close");
    };
    let m!: () => number;
    const { seen, dispose } = mount(() => (m = createMemo(() => from<number>(src as any))));
    expect(m()).toBe(7);
    expect(log).toEqual(["open", "close"]);
    await microtasks();
    expect(m()).toBe(7);
    expect(isPending(() => m())).toBe(false);
    dispose();
    expect(log).toEqual(["open", "close"]);
    expect(seen).toEqual([7]);
  });
});

describe("from: no owner and forbidden scopes", () => {
  it("emits no NO_OWNER_CLEANUP when created with no owner (after an await)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const capture = OBSERVE!.diagnostics.capture();
    const log: string[] = [];
    const src = source("a", log, { value: 1 });
    const { read, dispose } = mount(() =>
      createMemo(async function* () {
        await Promise.resolve();
        for await (const v of from<number>(src)) yield v * 2;
      })
    );
    await microtasks();
    expect(read()).toBe(2);
    // Plain no-owner iteration, too.
    const it = from<number>(source("b", log, { value: 1 }))[Symbol.asyncIterator]();
    await it.return!();
    const events = capture.stop();
    expect(events.map(e => e.code)).not.toContain("NO_OWNER_CLEANUP");
    expect(log).toEqual(["open a", "open b", "close b"]);
    dispose();
  });

  it("iterating inside a scope that forbids cleanups neither throws nor diagnoses", async () => {
    const capture = OBSERVE!.diagnostics.capture();
    const log: string[] = [];
    let it: AsyncIterator<number> | undefined;
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      createTrackedEffect(() => {
        it = from<number>(source("a", log, { value: 1 }))[Symbol.asyncIterator]();
      });
    });
    flush();
    expect(it).toBeDefined();
    await it!.return!();
    expect(log).toEqual(["open a", "close a"]);
    expect(capture.stop().map(e => e.code)).toEqual([]);
    dispose();
  });
});

describe("from: supersede closes the old source with no tick", () => {
  type Shape = "direct" | "for await";
  const build = (shape: Shape, sources: Map<string, ReturnType<typeof source<string>>>) => {
    const [x, setX] = createSignal("a");
    const m =
      shape === "direct"
        ? createMemo(() => from<string>(sources.get(x())!))
        : createMemo(async function* () {
            for await (const v of from<string>(sources.get(x())!)) yield v;
          });
    return { m, setX };
  };

  for (const shape of ["direct", "for await"] as const) {
    for (const emitsDuringSubscribe of [true, false]) {
      const when = emitsDuringSubscribe ? "during subscribe" : "later";
      it(`${shape}: new source emits ${when}`, async () => {
        const log: string[] = [];
        const sources = new Map([
          ["a", source("a", log, { value: "a1" })],
          ["b", source("b", log, emitsDuringSubscribe ? { value: "b1" } : undefined)]
        ]);
        let setX!: (v: string) => void;
        let m!: () => string;
        const { seen, dispose } = mount(() => {
          const r = build(shape, sources);
          setX = r.setX;
          return (m = r.m);
        });
        await microtasks();
        expect(m()).toBe("a1");
        expect(log).toEqual(["open a"]);

        setX("b");
        flush();
        // The point: closed now, before any tick and before b's value lands.
        expect(log).toEqual(["open a", "close a", "open b"]);

        // The stale source can no longer deliver.
        sources.get("a")!.next("a2");
        if (!emitsDuringSubscribe) sources.get("b")!.next("b1");
        await microtasks();
        expect(m()).toBe("b1");
        expect(seen).not.toContain("a2");
        expect(isPending(() => m())).toBe(false);
        expect(log).toEqual(["open a", "close a", "open b"]);

        dispose();
        expect(log).toEqual(["open a", "close a", "open b", "close b"]);
      });
    }
  }

  it("closes at supersede under a loading boundary that reads isPending", async () => {
    const log: string[] = [];
    const sources = new Map<string, ReturnType<typeof source<string>>>();
    let setQ!: (v: string) => void;
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      const [q, set] = createSignal("");
      setQ = set;
      const m = createMemo(async function* () {
        const v = q();
        if (!v) return;
        const src = source<string>(v, log);
        sources.set(v, src);
        for await (const x of from<string>(src)) yield x;
      });
      const view = createLoadingBoundary(
        () => {
          try {
            const pending = isPending(() => m());
            return { pending, value: latest(() => m()) };
          } catch {
            return undefined;
          }
        },
        () => "loading-fallback"
      );
      createEffect(
        () => view(),
        () => {}
      );
    });
    flush();

    setQ("a");
    flush();
    expect(log).toEqual(["open a"]);

    // Supersede before 'a' lands: the stale source must close NOW.
    setQ("ab");
    flush();
    expect(log).toEqual(["open a", "close a", "open ab"]);

    sources.get("ab")!.next("ab");
    await microtasks();
    sources.get("a")!.next("a");
    await microtasks();
    expect(log).toEqual(["open a", "close a", "open ab"]);
    dispose();
    expect(log).toEqual(["open a", "close a", "open ab", "close ab"]);
  });
});

describe("from: AsyncIterable sources", () => {
  /** A hand-written iterator: next() waits for land(); return() logs synchronously. */
  function handIterable(label: string, log: string[]) {
    const lands: Array<(r: IteratorResult<string>) => void> = [];
    let n = 0;
    return {
      land: () => lands.shift()?.({ value: `${label}${++n}`, done: false }),
      [Symbol.asyncIterator](): AsyncIterator<string> {
        log.push(`open ${label}`);
        return {
          next: () => new Promise(resolve => lands.push(resolve)),
          return: () => {
            log.push(`return ${label}`);
            return Promise.resolve({ value: undefined, done: true });
          }
        };
      }
    };
  }

  /** An async generator: yields `${label}1`, then parks on an await until release(). */
  function genIterable(label: string, log: string[]) {
    let release!: () => void;
    async function* gen() {
      log.push(`open ${label}`);
      try {
        yield `${label}1`;
        await new Promise<void>(r => (release = r));
        yield `${label}2`;
      } finally {
        log.push(`finally ${label}`);
      }
    }
    return {
      release: () => release(),
      [Symbol.asyncIterator]() {
        const g = gen();
        const ret = g.return.bind(g);
        g.return = (v?: any) => {
          log.push(`return ${label}`);
          return ret(v);
        };
        return g;
      }
    };
  }

  it("streams every value (no coalescing)", async () => {
    async function* gen() {
      yield 1;
      yield 2;
      yield 3;
    }
    const seen: number[] = [];
    for await (const v of from(gen())) seen.push(v);
    expect(seen).toEqual([1, 2, 3]);
  });

  it("for await, hand-written source: the old iterator's return() runs at supersede", async () => {
    const log: string[] = [];
    const sources = { a: handIterable("a", log), b: handIterable("b", log) };
    let setX!: (v: "a" | "b") => void;
    let m!: () => string;
    const { seen, dispose } = mount(() => {
      const [x, set] = createSignal<"a" | "b">("a");
      setX = set;
      return (m = createMemo(async function* () {
        for await (const v of from(sources[x()])) yield v;
      }));
    });
    sources.a.land();
    await microtasks();
    expect(m()).toBe("a1");

    setX("b");
    flush();
    expect(log).toEqual(["open a", "return a", "open b"]);

    sources.a.land();
    sources.b.land();
    await microtasks();
    expect(m()).toBe("b1");
    expect(seen).not.toContain("a2");
    dispose();
    expect(log).toEqual(["open a", "return a", "open b", "return b"]);
  });

  it("for await, async-generator source: return() is called at supersede, the generator finishes when its await settles", async () => {
    const log: string[] = [];
    const sources = { a: genIterable("a", log), b: genIterable("b", log) };
    let setX!: (v: "a" | "b") => void;
    let m!: () => string;
    const { seen, dispose } = mount(() => {
      const [x, set] = createSignal<"a" | "b">("a");
      setX = set;
      return (m = createMemo(async function* () {
        for await (const v of from(sources[x()])) yield v;
      }));
    });
    await microtasks();
    expect(m()).toBe("a1");

    setX("b");
    flush();
    // return() is called now; the language queues it behind the generator's
    // pending await, so its finally has not run yet.
    expect(log).toEqual(["open a", "return a", "open b"]);
    await microtasks();
    expect(m()).toBe("b1");
    expect(log).toEqual(["open a", "return a", "open b"]);

    // The await settles: the queued return() runs (finally), and the value
    // the generator yields on the way out goes nowhere.
    sources.a.release();
    await microtasks();
    expect(log).toEqual(["open a", "return a", "open b", "finally a"]);
    expect(seen).not.toContain("a2");
    expect(m()).toBe("b1");
    dispose();
    expect(log).toEqual(["open a", "return a", "open b", "finally a", "return b"]);
  });

  it("direct return: the old iterator closes at supersede", async () => {
    const log: string[] = [];
    const sources = { a: handIterable("a", log), b: handIterable("b", log) };
    let setX!: (v: "a" | "b") => void;
    const { dispose } = mount(() => {
      const [x, set] = createSignal<"a" | "b">("a");
      setX = set;
      return createMemo(() => from(sources[x()]));
    });
    sources.a.land();
    await microtasks();
    setX("b");
    flush();
    expect(log).toEqual(["open a", "return a", "open b"]);
    dispose();
    expect(log).toEqual(["open a", "return a", "open b", "return b"]);
  });

  it("dispose closes the iterator once, and a pending pull settles as done", async () => {
    const log: string[] = [];
    const src = handIterable("a", log);
    const { dispose } = mount(() =>
      createMemo(async function* () {
        for await (const v of from(src)) yield v;
        log.push("loop exited");
      })
    );
    expect(log).toEqual(["open a"]);
    dispose();
    expect(log).toEqual(["open a", "return a"]);
    await microtasks();
    expect(log).toEqual(["open a", "return a", "loop exited"]);
  });
});
