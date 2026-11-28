/**
 * #5240: a `latest()` reader served a corrected guess re-runs at the commit.
 *
 * An action writes an optimistic guess and waits; a `refresh()` from outside
 * the action lands a different truth beneath it. `latest` keeps the guess
 * until the commit (D-34), so the landing changes nothing a `latest()`
 * reader sees. The change from the guess to the truth happens at the commit,
 * which may land nothing on the node: the reader must be re-run there. It
 * stayed on the guess, beside a screen and an imperative `latest()` already
 * showing the truth.
 */
import {
  action,
  createEffect,
  createMemo,
  createOptimistic,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  getObserver,
  isPending,
  latest,
  refresh
} from "../src/index.js";
import { REACTIVE_FRAME_READ } from "../src/core/constants.js";
import { transactions } from "../src/core/scheduler.js";

afterEach(() => flush());

const settle = async (n = 4) => {
  for (let i = 0; i < n; i++) {
    flush();
    await new Promise(r => setTimeout(r, 0));
  }
};

type Form = "signal" | "keyed" | "keyNull";
type Frame = { screen: unknown; latest: unknown; pending: unknown; imperative: unknown };

function createOptimisticLabel(
  form: Form,
  serverLabel: () => string,
  { waitForMicrotask = false }: { waitForMicrotask?: boolean } = {}
) {
  if (form === "signal") {
    const [read, guess] = createOptimistic(async () => {
      if (waitForMicrotask) await Promise.resolve();
      return serverLabel();
    });
    return { read, guess, refresh: () => refresh(read) };
  }
  const [rows, setRows] = createOptimisticStore(
    async () => {
      if (waitForMicrotask) await Promise.resolve();
      return [{ id: "b", label: serverLabel() }];
    },
    [] as { id: string; label: string }[],
    { key: form === "keyed" ? "id" : null }
  );
  return {
    read: () => rows[0]?.label,
    guess: (value: string) => setRows(d => void (d[0].label = value)),
    refresh: () => refresh(rows)
  };
}

async function run(form: Form, opts: { truth: string; finalRefresh?: boolean }) {
  let server = "B";
  const seen: Record<string, unknown> = {};
  let latestRuns = 0;
  const pendings: unknown[] = [];
  const h = createRoot(dispose => {
    const slot = createOptimisticLabel(form, () => server, { waitForMicrotask: true });
    const { read } = slot;
    createRenderEffect(read, v => void (seen.screen = v));
    createRenderEffect(
      () => latest(read),
      v => {
        latestRuns++;
        seen.latest = v;
      }
    );
    createRenderEffect(
      () => isPending(read),
      v => {
        pendings.push(v);
        seen.pending = v;
      }
    );
    return { ...slot, dispose };
  });
  const frame = (): Frame => ({
    screen: seen.screen,
    latest: seen.latest,
    pending: seen.pending,
    imperative: latest(h.read)
  });

  await settle();
  const initial = frame();
  let finish!: () => void;
  const save = action(function* () {
    h.guess("Guess");
    yield new Promise<void>(r => (finish = r));
    if (opts.finalRefresh) h.refresh();
  })();
  await settle();
  const guessed = frame();
  server = opts.truth;
  h.refresh(); // outside the action
  await settle();
  const refreshed = frame();
  const runsBeforeEnd = latestRuns;
  finish();
  await save;
  await settle();
  const result = {
    initial,
    guessed,
    refreshed,
    end: frame(),
    pendings,
    runsAtEnd: latestRuns - runsBeforeEnd
  };
  h.dispose();
  return result;
}

const forms: Form[] = ["signal", "keyed", "keyNull"];

describe.each(forms)("#5240 %s", form => {
  it("the latest() binding shows the truth once the action ends without a refresh", async () => {
    const r = await run(form, { truth: "Server B" });
    // Check the pending trace even if the binding is stale at the commit (D-34).
    const pendingAtEachFrame = [r.initial, r.guessed, r.refreshed, r.end].map(f => f.pending);
    const expectedPendingTrace =
      form === "signal" ? [false, false, false, false, false] : [true, false, false, true, false];
    expect.soft(pendingAtEachFrame).toEqual([false, false, form !== "signal", false]);
    expect.soft(r.pendings).toEqual(expectedPendingTrace);
    expect(r.initial).toEqual({ screen: "B", latest: "B", pending: false, imperative: "B" });
    expect(r.guessed).toEqual({
      screen: "Guess",
      latest: "Guess",
      pending: false,
      imperative: "Guess"
    });
    // D-34: the guess stays on screen and in `latest` until the commit.
    expect(r.refreshed.screen).toBe("Guess");
    expect(r.refreshed.latest).toBe("Guess");
    expect(r.refreshed.imperative).toBe("Guess");
    expect(r.end).toEqual({
      screen: "Server B",
      latest: "Server B",
      pending: false,
      imperative: "Server B"
    });
    expect(r.runsAtEnd).toBe(1);
  });

  it("the action's own final refresh lands the truth on every reader", async () => {
    const r = await run(form, { truth: "Server B", finalRefresh: true });
    expect(r.end).toEqual({
      screen: "Server B",
      latest: "Server B",
      pending: false,
      imperative: "Server B"
    });
  });

  it("a truth equal to the guess commits with no wrong value", async () => {
    const r = await run(form, { truth: "Guess" });
    expect(r.refreshed).toMatchObject({ screen: "Guess", latest: "Guess" });
    expect(r.end).toEqual({
      screen: "Guess",
      latest: "Guess",
      pending: false,
      imperative: "Guess"
    });
    // Nothing it shows changes at the commit: no re-run.
    expect(r.runsAtEnd).toBe(0);
  });
});

// Review of the fix: the commit-time re-run is a listing for the landing,
// not a frame mark (F-6), validated there, and one entry per reader and node.

it.each(["signal", "keyed"] as const)(
  "#5240 %s: a latest() reader of a kept guess does not hold an unrelated flight (F-6)",
  async form => {
    let server = "B";
    const fetchY = Promise.withResolvers<string>();
    const endX = Promise.withResolvers<void>();
    const endY = Promise.withResolvers<void>();
    const shown: boolean[] = [];
    const h = createRoot(dispose => {
      const slot = createOptimisticLabel(form, () => server);
      const [query, setQuery] = createSignal(false);
      const y = createMemo(() => (query() ? fetchY.promise : "y0"));
      createRenderEffect(slot.read, () => {});
      createRenderEffect(query, v => void shown.push(v));
      createRenderEffect(
        () => latest(slot.read) + "/" + latest(y),
        () => {}
      );
      return { ...slot, setQuery, dispose };
    });
    await settle();
    const saveX = action(function* () {
      h.guess("G");
      yield endX.promise;
    })();
    await settle();
    server = "S";
    h.refresh();
    await settle();
    const saveY = action(function* () {
      h.setQuery(true);
      yield endY.promise;
    })();
    await settle();
    endY.resolve();
    await saveY;
    await settle();
    // Y's write shows while its fetch is pending because only `latest(y)` reads it (F-6).
    expect(shown.at(-1)).toBe(true);
    fetchY.resolve("y1");
    await settle();
    expect(shown.at(-1)).toBe(true);
    endX.resolve();
    await saveX;
    await settle();
    expect(latest(h.read)).toBe("S");
    h.dispose();
  }
);

describe("#5240: the commit re-runs only readers whose kept value changes", () => {
  async function commitRuns(mode: "different" | "confirmed" | "switched") {
    let server = "B";
    const runs: unknown[] = [],
      callbacks: unknown[] = [];
    const h = createRoot(() => {
      const [x, setX] = createOptimistic(async () => server);
      const [away, setAway] = createSignal(false);
      createRenderEffect(x, () => {});
      createRenderEffect(
        () => {
          // Switched away: still a `latest()` reader, not of x.
          const v = away() ? latest(() => "other") : latest(x);
          runs.push(v);
          return v;
        },
        v => void callbacks.push(v)
      );
      return { x, setX, setAway };
    });
    await settle();
    const end = Promise.withResolvers<void>();
    const save = action(function* () {
      h.setX("G");
      yield end.promise;
    })();
    await settle();
    server = "S";
    refresh(h.x); // a different truth: G is kept
    await settle();
    if (mode === "confirmed") {
      server = "G";
      refresh(h.x); // a second refresh confirms the guess
      await settle();
    }
    if (mode === "switched") {
      h.setAway(true);
      await settle();
    }
    const before = [runs.length, callbacks.length];
    end.resolve();
    await save;
    await settle();
    return {
      computes: runs.slice(before[0]),
      callbacks: callbacks.slice(before[1]),
      value: latest(h.x)
    };
  }

  it("a different truth: one compute and one callback, with the truth", async () => {
    expect(await commitRuns("different")).toEqual({
      computes: ["S"],
      callbacks: ["S"],
      value: "S"
    });
  });

  it("a later refresh confirming the guess: no compute, no callback", async () => {
    expect(await commitRuns("confirmed")).toEqual({ computes: [], callbacks: [], value: "G" });
  });

  it("a binding that switched away from the source: no compute, no callback", async () => {
    expect(await commitRuns("switched")).toEqual({ computes: [], callbacks: [], value: "S" });
  });
});

it("#5240: one re-run per reader at the commit, however often it read and re-ran", async () => {
  const count = 200;
  let server = "B";
  let commitRuns = 0;
  const h = createRoot(() => {
    const [rows, set] = createOptimisticStore(
      async () => Array.from({ length: count }, (_, id) => ({ id, label: server })),
      [] as { id: number; label: string }[]
    );
    const [tick, setTick] = createSignal(0);
    createRenderEffect(
      () => rows.length,
      () => {}
    );
    return {
      rows,
      set,
      setTick,
      mount: () => {
        for (const row of rows)
          createRenderEffect(
            () => {
              const n = tick();
              commitRuns++;
              // Five reads of the same field.
              return latest(() => row.label + row.label + row.label + row.label + row.label + n);
            },
            () => {}
          );
      }
    };
  });
  await settle();
  createRoot(() => h.mount());
  await settle();
  const end = Promise.withResolvers<void>();
  const save = action(function* () {
    h.set(d => {
      for (const row of d) row.label = "G";
    });
    yield end.promise;
  })();
  await settle();
  server = "S";
  refresh(h.rows);
  await settle();
  for (let i = 1; i <= 10; i++) {
    h.setTick(i);
    await settle();
  }
  commitRuns = 0;
  end.resolve();
  await save;
  await settle();
  expect(commitRuns).toBe(count);
  expect(transactions.length).toBe(0);
  expect(latest(() => h.rows[0].label)).toBe("S");
  // A later landing re-runs nothing on the old hold's account.
  commitRuns = 0;
  const end2 = Promise.withResolvers<void>();
  const save2 = action(function* () {
    h.set(d => void (d[0].label = "G2"));
    yield end2.promise;
  })();
  await settle();
  end2.resolve();
  await save2;
  await settle();
  expect(commitRuns).toBe(2);
});

// The landing's re-run: no frame mark, one compute, nothing kept for a
// disposed reader, linear in what the hold kept.
describe("#5240: the landing's re-run", () => {
  /** Action X guesses `x`; an outside refresh lands a different truth, so
   * the guess is kept. A binding reads `x` and an unrelated memo `y` through
   * `latest`; action Y sets `y`'s query, whose fetch is `fetchY`. */
  function scene(fault?: () => boolean) {
    let server = "B";
    const fetchY = Promise.withResolvers<string>();
    const endX = Promise.withResolvers<void>(),
      endY = Promise.withResolvers<void>();
    const shown: boolean[] = [],
      bound: string[] = [];
    let runs = 0;
    const h = createRoot(d => {
      const [x, setX] = createOptimistic(async () => server);
      const [query, setQuery] = createSignal(false);
      const y = createMemo(() => (query() ? fetchY.promise : "y0"));
      createRenderEffect(x, () => {});
      createRenderEffect(query, v => void shown.push(v));
      createRenderEffect(
        () => (runs++, latest(x) + "/" + latest(y)),
        v => void bound.push(v)
      );
      if (fault) {
        // A second kept reader that also reads a source that throws.
        const failing = createMemo(() => {
          if (fault()) throw new Error("fault");
          return "";
        });
        const combined = createMemo(() => latest(x) + "/" + latest(y) + failing());
        createEffect(combined, { effect: () => {}, error: () => {} });
      }
      return { x, setX, setQuery, dispose: d };
    });
    return {
      x: h.x,
      shown,
      bound,
      runs: () => runs,
      fetchY,
      async keep() {
        await settle();
        const saveX = action(function* () {
          h.setX("G");
          yield endX.promise;
        })();
        await settle();
        server = "S";
        refresh(h.x);
        await settle();
        return { saveX };
      },
      startY: () =>
        action(function* () {
          h.setQuery(true);
          yield endY.promise;
        })(),
      endX: () => endX.resolve(),
      endY: () => endY.resolve(),
      dispose: h.dispose
    };
  }

  it("a kept reader whose other source errored does not hold an unrelated flight (F-6)", async () => {
    const [broken, setBroken] = createSignal(false);
    const h = scene(broken);
    const { saveX } = await h.keep();
    const saveY = h.startY();
    await settle();
    setBroken(true);
    await settle();
    h.endX();
    await saveX;
    await settle();
    h.endY();
    await saveY;
    await settle();
    // Y's write shows when Y ends, its fetch still pending (F-6).
    expect(h.shown.at(-1)).toBe(true);
    h.fetchY.resolve("y1");
    await settle();
    expect(h.shown.at(-1)).toBe(true);
    h.dispose();
  });

  it("the kept hold lands while an unrelated action waits: one compute", async () => {
    const h = scene();
    const { saveX } = await h.keep();
    expect(h.bound.at(-1)).toBe("G/y0");
    const saveY = h.startY();
    await settle();
    const before = h.bound.length,
      runs = h.runs();
    h.endX();
    await saveX;
    await settle();
    expect(h.bound.slice(before)).toEqual(["S/y0"]);
    expect(h.runs() - runs).toBe(1);
    h.endY();
    await saveY;
    await settle();
    expect(h.shown.at(-1)).toBe(true);
    h.fetchY.resolve("y1");
    await settle();
    expect(h.bound.at(-1)).toBe("S/y1");
    h.dispose();
  });

  it("a disposed reader is not kept for the landing; the landing drains what it listed", async () => {
    const h = scene();
    const { saveX } = await h.keep();
    const t: any = transactions[0];
    let disposedRuns = 0;
    for (let i = 0; i < 20; i++) {
      const stop = createRoot(d => {
        createRenderEffect(
          () => (disposedRuns++, latest(h.x)),
          () => {}
        );
        return d;
      });
      flush();
      stop();
      flush();
    }
    disposedRuns = 0;
    h.endX();
    await saveX;
    await settle();
    expect(disposedRuns).toBe(0);
    expect(h.bound.at(-1)).toBe("S/y0");
    expect(transactions).not.toContain(t);
    expect(t._reruns.length).toBe(0);
    h.dispose();
  });

  it("a throwing equals comparator: the landing does not call it, nothing stays on the guess", async () => {
    let server = "B",
      throwNow = false,
      calls = 0;
    const errors: unknown[] = [];
    const end = Promise.withResolvers<void>();
    let screen: unknown, binding: unknown;
    const h = createRoot(dispose => {
      const [x, setX] = createOptimistic(async () => server, {
        equals(a, b) {
          if (throwNow) {
            calls++;
            throw new Error("comparator");
          }
          return a === b;
        }
      });
      createRenderEffect(x, v => void (screen = v));
      createRenderEffect(
        () => latest(x),
        v => void (binding = v)
      );
      return { x, setX, dispose };
    });
    await settle();
    const save = action(function* () {
      h.setX("G");
      yield end.promise;
    })();
    await settle();
    server = "S";
    refresh(h.x);
    await settle();
    expect([screen, binding]).toEqual(["G", "G"]);
    throwNow = true;
    try {
      end.resolve();
      await save.catch(e => errors.push(e));
      try {
        await settle();
      } catch (e) {
        errors.push(e);
      }
      expect(errors).toEqual([]);
      expect(calls).toBe(0);
      expect([screen, binding, latest(h.x)]).toEqual(["S", "S", "S"]);
    } finally {
      throwNow = false;
      h.dispose();
    }
  });

  it("independent holds: each landing visits its own readers, not every hold's", async () => {
    const n = 64;
    let server = "B";
    const shown: unknown[] = [];
    const computes: number[] = Array(n).fill(0);
    const h = Array.from({ length: n }, (_, i) =>
      createRoot(dispose => {
        const [x, setX] = createOptimistic(async () => server);
        createRenderEffect(
          () => (computes[i]++, latest(x)),
          v => void (shown[i] = v)
        );
        return { x, setX, end: Promise.withResolvers<void>(), dispose };
      })
    );
    await settle();
    const saves = h.map(row => {
      const save = action(function* () {
        row.setX("G");
        yield row.end.promise;
      })();
      flush();
      return save;
    });
    server = "S";
    for (const row of h) {
      refresh(row.x);
      await settle();
    }
    expect(transactions.length).toBe(n);
    try {
      for (let i = 0; i < n; i++) {
        const before = computes.slice();
        h[i].end.resolve();
        await saves[i];
        flush();
        expect(shown[i]).toBe("S");
        if (i + 1 < n) expect(shown[i + 1]).toBe("G");
        // Only the landing hold's reader re-runs, once.
        expect(computes.map((c, k) => c - before[k])).toEqual(
          computes.map((_, k) => (k === i ? 1 : 0))
        );
        expect(transactions.length).toBe(n - i - 1);
      }
    } finally {
      h.forEach(row => row.dispose());
    }
  });

  it("one reader of every kept field: the landing is linear in the fields", async () => {
    const n = 1000;
    let server = "B";
    let reader: any;
    let shown = "";
    const h = createRoot(d => {
      const [rows, set] = createOptimisticStore(
        async () => Array.from({ length: n }, (_, id) => ({ id, label: server })),
        [] as { id: number; label: string }[]
      );
      createRenderEffect(
        () => rows.length,
        () => {}
      );
      createRenderEffect(
        () => ((reader = getObserver()), latest(() => rows.map(r => r.label).join(""))),
        v => void (shown = v)
      );
      return { rows, set, dispose: d };
    });
    await settle();
    const end = Promise.withResolvers<void>();
    const save = action(function* () {
      h.set(d => {
        for (const row of d) row.label = "G";
      });
      yield end.promise;
    })();
    await settle();
    server = "S";
    refresh(h.rows);
    await settle();
    expect(shown).toBe("G".repeat(n));
    // Count the landing's walks of the reader's dependency links.
    let reads = 0;
    for (let l = reader._deps; l !== null; l = l._nextDep) {
      let dep = l._dep;
      Object.defineProperty(l, "_dep", {
        get: () => (reads++, dep),
        set: v => void (dep = v),
        configurable: true
      });
    }
    end.resolve();
    await save;
    await settle();
    expect(shown).toBe("S".repeat(n));
    expect(reads).toBeLessThan(20 * n);
    h.dispose();
  });
});

// The landing's check is the engine's same-value one (no comparator runs):
// `+0` and `-0` differ, `NaN` is itself. With `equals: false` every commit
// is a change: the kept reader re-runs as the screen's reader does.
describe("#5240: the landing's same-value check", () => {
  const show = (v: unknown) => (Object.is(v, -0) ? "-0" : Number.isNaN(v) ? "NaN" : v);
  async function land(guess: unknown, truth: unknown, equals: unknown) {
    let server: unknown = "B";
    let screen: unknown, binding: unknown;
    let computes = 0;
    const h = createRoot(dispose => {
      const [x, setX] = createOptimistic(async () => server, { equals } as any);
      createRenderEffect(x, v => void (screen = show(v)));
      createRenderEffect(
        () => (computes++, latest(x)),
        v => void (binding = show(v))
      );
      return { x, setX, dispose };
    });
    await settle();
    const end = Promise.withResolvers<void>();
    const save = action(function* () {
      h.setX(guess);
      yield end.promise;
    })();
    await settle();
    server = truth;
    refresh(h.x);
    await settle();
    expect(binding).toBe(show(guess));
    const before = computes;
    end.resolve();
    await save;
    await settle();
    const out = { screen, binding, imperative: show(latest(h.x)), computes: computes - before };
    h.dispose();
    return out;
  }

  it.each([
    ["equals: false", false],
    ["equals: Object.is", Object.is]
  ])("a +0 guess, -0 committed (%s): the binding shows -0", async (_, equals) => {
    expect(await land(0, -0, equals)).toEqual({
      screen: "-0",
      binding: "-0",
      imperative: "-0",
      computes: 1
    });
  });

  it("a NaN guess, NaN staged beneath it: no compute", async () => {
    expect(await land(NaN, NaN, undefined)).toEqual({
      screen: "NaN",
      binding: "NaN",
      imperative: "NaN",
      computes: 0
    });
  });

  it("equals: false, a staging that confirms the guess: one compute, as the screen's", async () => {
    expect(await land("G", "G", false)).toMatchObject({ binding: "G", computes: 1 });
  });
});

// A throw while the hold's lanes end (a guess's `equals`, an existing path)
// skips its landing after the scheduler removed it: the registry lets go of
// the hold before that, and disposing the reader leaves nothing.
it("#5240: a hold whose lanes' end throws leaves no mark and retains no reader", async () => {
  const errors: string[] = [];
  const onError = (e: unknown) => void errors.push((e as Error).message);
  process.on("unhandledRejection", onError);
  process.on("uncaughtException", onError);
  const resume = Promise.withResolvers<void>(),
    end = Promise.withResolvers<void>();
  let server = "B",
    finishing = false,
    calls = 0;
  const h = createRoot(dispose => {
    const [x, setX] = createOptimistic(async () => server);
    const [y, setY] = createOptimistic("b", {
      equals(a, b) {
        if (!finishing) return a === b;
        if (++calls === 2) throw new Error("lane teardown");
        return true;
      }
    });
    createRenderEffect(y, () => {});
    return { x, setX, setY, dispose };
  });
  // The kept reader, in a root of its own.
  const reader = createRoot(d => {
    let c: any;
    createRenderEffect(
      () => ((c ??= getObserver()), latest(h.x)),
      () => {}
    );
    return {
      get c() {
        return c;
      },
      d
    };
  });
  try {
    await settle();
    const save = action(function* () {
      h.setX("G");
      yield resume.promise;
      h.setY("g");
      yield end.promise;
    })();
    await settle();
    server = "S";
    refresh(h.x);
    await settle();
    resume.resolve();
    await settle();
    expect(transactions.length).toBe(1);
    finishing = true;
    end.resolve();
    await save.catch(onError);
    await settle();
    expect(errors).toEqual(["lane teardown"]);
    expect(transactions.length).toBe(0);
    // No frame mark left on the reader: it holds no later flight (F-6).
    expect(reader.c._flags & REACTIVE_FRAME_READ).toBe(0);
    reader.d();
    h.dispose();
    await settle();
  } finally {
    finishing = false;
    process.off("unhandledRejection", onError);
    process.off("uncaughtException", onError);
    h.dispose();
  }
});

// Beyond the PR's suite: the other ways a hold ends, and other reader shapes.
describe.each(forms)("#5240 %s: more endings and readers", form => {
  async function keep(
    body: (slot: ReturnType<typeof createOptimisticLabel>) => Generator<any, void, any>,
    readers: (read: () => unknown) => Record<string, () => unknown>
  ) {
    let server = "B";
    const end = Promise.withResolvers<void>();
    const counts: Record<string, number> = {};
    const seen: Record<string, unknown> = {};
    const h = createRoot(dispose => {
      const slot = createOptimisticLabel(form, () => server);
      createRenderEffect(slot.read, v => void (seen.screen = v));
      for (const [k, fn] of Object.entries(readers(slot.read))) {
        counts[k] = 0;
        createRenderEffect(
          () => (counts[k]++, fn()),
          v => void (seen[k] = v)
        );
      }
      return { slot, dispose };
    });
    await settle();
    const save = action(function* () {
      h.slot.guess("G");
      yield end.promise;
      yield* body(h.slot);
    })();
    await settle();
    server = "S";
    h.slot.refresh();
    await settle();
    const kept = { ...seen };
    const before = { ...counts };
    end.resolve();
    await save.catch(() => {});
    await settle();
    const runs = Object.fromEntries(Object.keys(counts).map(k => [k, counts[k] - before[k]]));
    const out = { kept, end: { ...seen, imperative: latest(h.slot.read) }, runs };
    h.dispose();
    return out;
  }
  const latestReader = (read: () => unknown) => ({ latest: () => latest(read) });

  it("a rejected action: the binding shows the truth", async () => {
    const r = await keep(function* () {
      throw new Error("rejected");
    }, latestReader);
    expect(r.kept).toEqual({ screen: "G", latest: "G" });
    expect(r.end).toEqual({ screen: "S", latest: "S", imperative: "S" });
  });

  it("a memo over latest(), and an effect over it", async () => {
    let memoRuns = 0,
      effectSeen: unknown;
    const r = await keep(
      function* () {},
      read => {
        const m = createMemo(() => (memoRuns++, latest(read)));
        createEffect(m, v => void (effectSeen = v));
        return { memo: m };
      }
    );
    expect(r.end).toEqual({ screen: "S", memo: "S", imperative: "S" });
    expect(effectSeen).toBe("S");
  });

  it("a reader of latest(x) and x(): one compute, the truth", async () => {
    const r = await keep(
      function* () {},
      read => ({ both: () => latest(read) + "/" + read() })
    );
    expect(r.kept.both).toBe("G/G");
    expect(r.end.both).toBe("S/S");
    expect(r.runs.both).toBeLessThanOrEqual(2);
  });

  it("guessed again after the correction: every reader agrees at the end", async () => {
    const r = await keep(function* (slot) {
      slot.guess("G2");
      yield Promise.resolve();
    }, latestReader);
    expect(r.end.latest).toBe(r.end.screen);
    expect(r.end.imperative).toBe(r.end.screen);
  });
});

/** The record of a kept read is the pass's link to the kept slot: a pull of
 * the reader, an unrelated hold's failed landing, or a link a later pass
 * dropped does not change which readers a landing re-runs. */
describe("#5240: the kept read is recorded on the reader's link", () => {
  it("refreshing a memo over latest() keeps its re-run at the commit", async () => {
    let server = "B",
      shown: string | undefined;
    const end = Promise.withResolvers<void>();
    const h = createRoot(dispose => {
      const [x, guess] = createOptimistic(async () => server);
      const memo = createMemo(() => latest(x));
      createRenderEffect(memo, v => void (shown = v));
      return { x, guess, memo, dispose };
    });
    try {
      await settle();
      const save = action(function* () {
        h.guess("G");
        yield end.promise;
      })();
      await settle();
      server = "S";
      refresh(h.x);
      await settle();
      expect(shown).toBe("G");
      const reread = refresh(h.memo);
      await settle();
      end.resolve();
      await save;
      await settle();
      expect(shown).toBe("S");
      expect(latest(h.x)).toBe("S");
      await reread;
    } finally {
      h.dispose();
    }
  });

  it("a hold whose lanes' end throws does not lose another hold's re-run", async () => {
    const errors: string[] = [];
    const onError = (e: unknown) => void errors.push((e as Error).message);
    process.on("unhandledRejection", onError);
    process.on("uncaughtException", onError);
    const resume = Promise.withResolvers<void>(),
      endX = Promise.withResolvers<void>(),
      endZ = Promise.withResolvers<void>();
    let server = "B",
      finishing = false,
      calls = 0,
      observer: any,
      shown: string | undefined;
    const h = createRoot(dispose => {
      const [x, setX] = createOptimistic(async () => server);
      const [y, setY] = createOptimistic("b", {
        equals(a, b) {
          if (!finishing) return a === b;
          if (++calls === 2) throw new Error("lane teardown");
          return true;
        }
      });
      const [z, setZ] = createOptimistic(async () => server);
      createRenderEffect(y, () => {});
      return { x, setX, setY, z, setZ, dispose };
    });
    const stop = createRoot(d => {
      createRenderEffect(
        () => ((observer = getObserver()), latest(h.x) + "/" + latest(h.z)),
        v => void (shown = v)
      );
      return d;
    });
    try {
      await settle();
      const saveX = action(function* () {
        h.setX("GX");
        yield resume.promise;
        h.setY("g");
        yield endX.promise;
      })();
      await settle();
      const saveZ = action(function* () {
        h.setZ("GZ");
        yield endZ.promise;
      })();
      await settle();
      server = "S";
      refresh(h.x);
      await settle();
      refresh(h.z);
      await settle();
      resume.resolve();
      await settle();
      expect(shown).toBe("GX/GZ");
      expect(transactions.length).toBe(2);
      const txX = transactions[0];
      finishing = true;
      endX.resolve();
      await saveX.catch(onError);
      await settle();
      finishing = false;
      expect(errors).toEqual(["lane teardown"]);
      expect(transactions).not.toContain(txX);
      // The failed landing queued nothing: the reader is not retained by it.
      expect(txX._reruns).not.toContain(observer);
      endZ.resolve();
      await saveZ;
      await settle();
      expect(shown?.endsWith("/S")).toBe(true);
      expect(latest(h.z)).toBe("S");
      stop();
      h.dispose();
      await settle();
      expect(txX._reruns).not.toContain(observer);
    } finally {
      finishing = false;
      process.off("unhandledRejection", onError);
      process.off("uncaughtException", onError);
      stop();
      h.dispose();
    }
  });

  it("a link to a kept slot the pass dropped schedules no extra compute", async () => {
    let server = "B",
      computes = 0;
    const callbacks: string[] = [];
    const h = createRoot(dispose => {
      const [x, guessX] = createOptimistic(async () => server);
      const [y, guessY] = createOptimistic(async () => server);
      const [away, setAway] = createSignal(false);
      createRenderEffect(x, () => {});
      createRenderEffect(y, () => {});
      createRenderEffect(
        () => (computes++, latest(x) + "/" + (latest(away) ? "away" : latest(y))),
        v => void callbacks.push(v)
      );
      return { x, y, guessX, guessY, setAway, dispose };
    });
    const start = (guess: (v: string) => void, value: string, finish?: () => void) => {
      const end = Promise.withResolvers<void>();
      const saved = action(function* () {
        guess(value);
        yield end.promise;
        finish?.();
      })();
      return { end: end.resolve, saved };
    };
    try {
      await settle();
      const a = start(h.guessX, "GX");
      await settle();
      const b = start(h.guessY, "GY", () => h.setAway(true));
      await settle();
      server = "S";
      refresh(h.x);
      await settle();
      refresh(h.y);
      await settle();
      expect(callbacks.at(-1)).toBe("GX/GY");
      const before = computes;
      b.end();
      await b.saved;
      await settle();
      expect(callbacks.at(-1)).toBe("GX/away");
      expect(computes - before).toBe(1);
      a.end();
      await a.saved;
      await settle();
      expect(callbacks.at(-1)).toBe("S/away");
    } finally {
      h.dispose();
    }
  });
});
