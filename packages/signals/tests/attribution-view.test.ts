// `openView` alone, with the attribution engine off unless a test enables it,
// pinned through explicit maps: lifecycle, what a pin is, held-back passes,
// async, disposal, and the engine beside it.
// Tests named "known gap" pin a shortfall, not a wanted behavior; each is
// listed in 08-dev-diagnostics.md.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  action,
  createEffect,
  createMemo,
  createOptimistic,
  createRenderEffect,
  createRoot,
  createSignal,
  createTrackedEffect,
  DEV,
  flush,
  getOwner,
  OBSERVE
} from "../src/index.js";
import { attribution, openView, type View } from "../src/attribution.js";

const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));

let view: View | undefined;
let dispose: (() => void) | undefined;
afterEach(() => {
  view?.resume();
  view = undefined;
  dispose?.();
  dispose = undefined;
  flush();
  attribution.disable();
  vi.restoreAllMocks();
});

/** A signal and its node (the root's signals, in creation order). */
function signal(value: number, name?: string) {
  const [read, write] = createSignal<number>(value, name ? { name } : undefined);
  const owned = DEV!.getSignals(getOwner()!);
  return {
    read,
    write: write as (v: number | ((prev: number) => number)) => void,
    node: owned[owned.length - 1] as object
  };
}

/** An async memo and its node; `fetches` counts the questions it asked. */
function asyncMemo<T, R>(source: () => T, answer: (v: T) => R, ms = 10) {
  const out = { node: undefined as unknown as object, fetches: 0, read: undefined as any };
  out.read = createMemo(async () => {
    out.node = getOwner()!;
    const v = source();
    out.fetches++;
    await tick(ms);
    return answer(v);
  });
  return out as { node: object; fetches: number; read: () => R };
}

function root<T>(fn: () => T): T {
  return createRoot(d => {
    dispose = d;
    return fn();
  });
}

function logOf(compute: () => string): string[] {
  const log: string[] = [];
  createRenderEffect(compute, v => void log.push(v));
  return log;
}

const pins = (...entries: [object, unknown][]) => new Map<object, unknown>(entries);

describe("openView: lifecycle", () => {
  it("throws while another view is open", () => {
    view = openView();
    expect(() => openView()).toThrow(/already open/);
  });

  it("show() after the view was left throws; resume() and branch() again are safe", () => {
    const v = openView();
    expect(v.resume()).toBe(true);
    expect(() => v.show(new Map())).toThrow(/left/);
    expect(v.resume()).toBe(true);
    v.branch();
    const w = openView();
    w.branch();
    w.branch();
    expect(w.resume()).toBe(true);
    expect(w.landing()).toBe(false);
  });

  it("opening and resuming with no show() is a no-op that returns true", () => {
    const { a, log, seen } = root(() => {
      const a = signal(1);
      const seen: number[] = [];
      createEffect(a.read, v => void seen.push(v));
      return { a, log: logOf(() => `${a.read()}`), seen };
    });
    flush();
    const n = log.length;
    const v = openView();
    expect(v.resume()).toBe(true);
    flush();
    expect(log.length).toBe(n);
    expect(seen).toEqual([1]);
    a.write(2);
    flush();
    expect(log.at(-1)).toBe("2");
  });

  it("throws inside an effect, an action body and a flush", async () => {
    const errors: string[] = [];
    const attempt = (what: string, fn: () => void) => {
      try {
        fn();
      } catch (e) {
        errors.push(`${what}: ${(e as Error).message.split(" was called")[0]}`);
      }
    };
    root(() => {
      const a = signal(1);
      createEffect(a.read, () => attempt("effect", () => (view = openView())));
    });
    flush();
    const run = action(function* () {
      attempt("action", () => (view = openView()));
    });
    await run();
    flush(() => attempt("flush(fn)", () => (view = openView())));
    expect(errors).toEqual(["effect: openView", "action: openView"]);
    // `flush(fn)` runs `fn` before the drain: the view opens.
    expect(view).toBeDefined();
  });

  it("show() inside an effect throws", () => {
    view = openView();
    const errors: unknown[] = [];
    root(() => {
      createEffect(
        () => 0,
        () => {
          try {
            view!.show(new Map());
          } catch (e) {
            errors.push(e);
          }
        }
      );
    });
    view.resume();
    view = undefined;
    flush();
    expect(errors.length).toBe(1);
  });
});

describe("openView: pins", () => {
  it("a pin is shown through the render path; sync derivations re-derive from it", () => {
    const { a, double, log } = root(() => {
      const a = signal(1);
      const double = createMemo(() => a.read() * 2);
      return { a, double, log: logOf(() => `${a.read()}/${double()}`) };
    });
    flush();
    a.write(2);
    flush();
    view = openView();
    view.show(pins([a.node, 1]));
    expect(log.at(-1)).toBe("1/2");
    expect(a.read()).toBe(1);
    expect(double()).toBe(2);
  });

  it("a sync derivation in the map is not pinned", () => {
    let doubleNode!: object;
    const { a, log } = root(() => {
      const a = signal(1);
      const double = createMemo(() => ((doubleNode = getOwner()!), a.read() * 2));
      return { a, log: logOf(() => `${a.read()}/${double()}`) };
    });
    flush();
    view = openView();
    view.show(pins([a.node, 5], [doubleNode, 99]));
    expect(log.at(-1)).toBe("5/10");
  });

  it("show() replaces the pin set: a node dropped from the map shows what it showed at open", () => {
    const { a, b, log } = root(() => {
      const a = signal(1);
      const b = signal(10);
      return { a, b, log: logOf(() => `${a.read()}/${b.read()}`) };
    });
    flush();
    view = openView();
    view.show(pins([a.node, 2], [b.node, 20]));
    expect(log.at(-1)).toBe("2/20");
    view.show(pins([b.node, 30]));
    expect(log.at(-1)).toBe("1/30");
    view.show(new Map());
    expect(log.at(-1)).toBe("1/10");
    expect(view.resume()).toBe(true);
    expect(log.at(-1)).toBe("1/10");
  });

  it("live writes are hidden until resume; the pinned node's truth lands then", () => {
    const { a, b, log } = root(() => {
      const a = signal(1);
      const b = signal(10);
      return { a, b, log: logOf(() => `${a.read()}/${b.read()}`) };
    });
    flush();
    view = openView();
    view.show(pins([a.node, 0]));
    a.write(2);
    b.write(20);
    flush();
    expect(log.at(-1)).toBe("0/10");
    expect(view.resume()).toBe(true);
    expect(log.at(-1)).toBe("2/20");
  });

  it("branch(): the pins become the truth and the live writes beneath are dropped", () => {
    const { a, b, log } = root(() => {
      const a = signal(1);
      const b = signal(10);
      return { a, b, log: logOf(() => `${a.read()}/${b.read()}`) };
    });
    flush();
    view = openView();
    view.show(pins([a.node, 5]));
    a.write(2);
    b.write(20);
    flush();
    view.branch();
    view = undefined;
    expect(log.at(-1)).toBe("5/10");
    expect([a.read(), b.read()]).toEqual([5, 10]);
    a.write(v => v + 1);
    flush();
    expect(log.at(-1)).toBe("6/10");
  });

  it("known gap: a synchronous optimistic memo that carried a guess reads as asked, and is pinned", async () => {
    // No field says a derivation asked: a guess stamps the same question a
    // flight does.
    let guessedNode!: object;
    let plainNode!: object;
    const { a, setGuessed, log } = root(() => {
      const a = signal(1);
      const [guessed, setGuessed] = createOptimistic(
        () => ((guessedNode = getOwner()!), a.read() * 10)
      );
      const plain = createMemo(() => ((plainNode = getOwner()!), a.read() * 10));
      return { a, setGuessed, log: logOf(() => `${a.read()}/${guessed()}/${plain()}`) };
    });
    flush();
    await action(function* () {
      setGuessed(99);
      yield tick();
    })();
    flush();
    expect(log.at(-1)).toBe("1/10/10");
    view = openView();
    view.show(pins([a.node, 2], [guessedNode, 7], [plainNode, 7]));
    // The plain memo re-derives (20); the optimistic one shows the map's 7.
    expect(log.at(-1)).toBe("2/7/20");
  });
});

describe("openView: held-back passes", () => {
  function effectSetup(options?: { effects?: boolean }) {
    const ev: string[] = [];
    const a = root(() => {
      const a = signal(1);
      createEffect(a.read, v => {
        ev.push(`run${v}`);
        return () => ev.push(`clean${v}`);
      });
      return a;
    });
    flush();
    ev.length = 0;
    view = openView(options);
    return { a, ev };
  }

  it("nothing changed beneath: no user effect runs and no cleanup at resume", () => {
    const { a, ev } = effectSetup();
    view!.show(pins([a.node, 7]));
    view!.resume();
    flush();
    expect(ev).toEqual([]);
  });

  it("a source's truth moved beneath: one run at the landing, with the landed value", () => {
    const { a, ev } = effectSetup();
    view!.show(pins([a.node, 7]));
    a.write(2);
    flush();
    a.write(3);
    flush();
    expect(ev).toEqual([]);
    view!.resume();
    flush();
    expect(ev).toEqual(["clean1", "run3"]);
  });

  it("a source that moved and ended where it started: no run", () => {
    const { a, ev } = effectSetup();
    view!.show(pins([a.node, 7]));
    a.write(2);
    flush();
    a.write(1);
    flush();
    view!.resume();
    flush();
    expect(ev).toEqual([]);
  });

  it("effects: true runs user effects on the view", () => {
    const { a, ev } = effectSetup({ effects: true });
    view!.show(pins([a.node, 7]));
    expect(ev).toEqual(["clean1", "run7"]);
    view!.resume();
    flush();
    expect(ev).toEqual(["clean1", "run7", "clean7", "run1"]);
  });

  it("an effect created while the view is open runs at the landing", () => {
    view = openView();
    const ev: number[] = [];
    root(() => {
      const a = signal(1);
      createEffect(a.read, v => void ev.push(v));
    });
    flush();
    expect(ev).toEqual([]);
    view.resume();
    view = undefined;
    flush();
    expect(ev).toEqual([1]);
  });

  it("an effect disposed while the view is open does not run, and resume does not throw", () => {
    const { a, ev } = effectSetup();
    a.write(2);
    flush();
    dispose!();
    dispose = undefined;
    expect(() => view!.resume()).not.toThrow();
    flush();
    expect(ev).toEqual(["clean1"]);
  });

  it("createTrackedEffect waits like a user effect", () => {
    const seen: number[] = [];
    const a = root(() => {
      const a = signal(1);
      createTrackedEffect(() => void seen.push(a.read()));
      return a;
    });
    flush();
    view = openView();
    view.show(pins([a.node, 5]));
    a.write(2);
    flush();
    expect(seen).toEqual([1]);
    view.resume();
    flush();
    expect(seen).toEqual([1, 2]);
  });

  it("render effects run on the view", () => {
    const { a, log } = root(() => {
      const a = signal(1);
      return { a, log: logOf(() => `${a.read()}`) };
    });
    flush();
    view = openView();
    view.show(pins([a.node, 3]));
    view.show(pins([a.node, 4]));
    expect(log).toEqual(["1", "3", "4"]);
  });
});

describe("openView: async", () => {
  async function asyncSetup() {
    const s = root(() => {
      const id = signal(1, "id");
      const user = asyncMemo(id.read, i => `u${i}`);
      return { id, user, log: logOf(() => `${id.read()}/${user.read()}`) };
    });
    await tick(30);
    flush();
    s.id.write(2);
    flush();
    await tick(30);
    flush();
    expect(s.log.at(-1)).toBe("2/u2");
    return s;
  }

  it("a pinned async memo asks nothing while viewing, between pins or on resume", async () => {
    const { id, user, log } = await asyncSetup();
    view = openView();
    view.show(pins([id.node, 1], [user.node, "u1"]));
    expect(log.at(-1)).toBe("1/u1");
    await tick(30);
    flush();
    view.show(pins([id.node, 2], [user.node, "u2"]));
    view.show(pins([id.node, 1], [user.node, "u1"]));
    await tick(30);
    flush();
    expect(log.at(-1)).toBe("1/u1");
    expect(view.resume()).toBe(true);
    await tick(30);
    flush();
    expect(log.at(-1)).toBe("2/u2");
    expect(user.fetches).toBe(2);
  });

  for (const order of ["input first", "async reader first"] as const)
    it(`opening while a refetch is in flight does not overflow (${order})`, async () => {
      const { id, user, log } = await asyncSetup();
      id.write(3);
      flush();
      view = openView();
      const entries: [object, unknown][] = [
        [id.node, 1],
        [user.node, "u1"]
      ];
      view.show(pins(...(order === "input first" ? entries : entries.reverse())));
      expect(log.at(-1)).toBe("1/u1");
      // show() again while the flight beneath is still in flight.
      view.show(pins([user.node, "u2"], [id.node, 2]));
      expect(log.at(-1)).toBe("2/u2");
      await tick(30);
      flush();
      expect(log.at(-1)).toBe("2/u2");
      view.resume();
      view = undefined;
      await tick(30);
      flush();
      expect(log.at(-1)).toBe("3/u3");
    });

  for (const order of ["a,b,c", "a,c,b", "b,c,a", "c,b,a"])
    it(`a pinned chain a → async b → async c does not overflow (${order})`, async () => {
      const s = root(() => {
        const a = signal(1, "a");
        const b = asyncMemo(a.read, v => v * 10);
        const c = asyncMemo(b.read, v => v + 1);
        return { a, b, c, log: logOf(() => `${a.read()}/${b.read()}/${c.read()}`) };
      });
      const settle = async () => {
        for (let i = 0; i < 3; i++) (await tick(20), flush());
      };
      await settle();
      s.a.write(2);
      flush();
      await settle();
      expect(s.log.at(-1)).toBe("2/20/21");
      s.a.write(3);
      flush();
      const nodes: Record<string, object> = { a: s.a.node, b: s.b.node, c: s.c.node };
      const at = (values: Record<string, unknown>) =>
        new Map(order.split(",").map(k => [nodes[k], values[k]] as [object, unknown]));
      view = openView();
      view.show(at({ a: 1, b: 10, c: 11 }));
      expect(s.log.at(-1)).toBe("1/10/11");
      view.show(at({ a: 2, b: 20, c: 21 }));
      expect(s.log.at(-1)).toBe("2/20/21");
      await settle();
      expect(s.log.at(-1)).toBe("2/20/21");
      view.resume();
      view = undefined;
      await settle();
      expect(s.log.at(-1)).toBe("3/30/31");
    });

  it("an input pinned by one show() and its held async reader by the next does not overflow", async () => {
    const { id, user, log } = await asyncSetup();
    id.write(3);
    flush();
    view = openView();
    view.show(pins([id.node, 1]));
    view.show(pins([id.node, 1], [user.node, "u1"]));
    expect(log.at(-1)).toBe("1/u1");
    view.resume();
    view = undefined;
    await tick(30);
    flush();
    expect(log.at(-1)).toBe("3/u3");
  });

  it("resume() is false while the landing waits; landing() turns false when it lands", async () => {
    const { id, user, log } = await asyncSetup();
    const v = openView();
    v.show(pins([id.node, 1], [user.node, "u1"]));
    id.write(3);
    flush();
    expect(v.resume()).toBe(false);
    expect(v.landing()).toBe(true);
    expect(log.at(-1)).toBe("1/u1");
    await tick(30);
    flush();
    expect(v.landing()).toBe(false);
    expect(v.resume()).toBe(true);
    expect(log.at(-1)).toBe("3/u3");
    expect(user.fetches).toBe(3);
  });
});

describe("openView: disposal", () => {
  it("a pinned node disposed while the view is open: show, resume and branch do not throw", () => {
    let inner!: { node: object; dispose: () => void };
    const a = root(() => {
      const a = signal(1);
      createRoot(d => {
        const user = asyncMemo(a.read, v => v);
        inner = { node: user.node, dispose: d };
        createRenderEffect(user.read, () => {});
      });
      return a;
    });
    flush();
    view = openView();
    view.show(pins([a.node, 2], [inner.node, 2]));
    inner.dispose();
    expect(() => view!.show(pins([a.node, 3], [inner.node, 3]))).not.toThrow();
    expect(() => view!.resume()).not.toThrow();
    view = openView();
    view.show(pins([a.node, 4]));
    expect(() => view!.branch()).not.toThrow();
    view = undefined;
    expect(a.read()).toBe(4);
  });
});

describe("openView: with the attribution engine enabled", () => {
  it("show, resume and branch emit no diagnostics; the landing's flush record lists it", async () => {
    attribution.enable({ log: false });
    const codes: string[] = [];
    const off = OBSERVE!.diagnostics.subscribe(e => void codes.push(e.code));
    const flushes: string[][] = [];
    const offFlush = OBSERVE!.records.subscribe(
      "flush",
      e => void flushes.push((e.changes ?? []).map(c => c.nodeName))
    );
    try {
      const s = root(() => {
        const a = signal(1, "a");
        const id = signal(1, "id");
        const user = asyncMemo(id.read, i => `u${i}`);
        return { a, id, user, log: logOf(() => `${a.read()}/${user.read()}`) };
      });
      await tick(30);
      flush();
      s.a.write(2);
      flush();
      codes.length = 0;
      view = openView();
      view.show(pins([s.a.node, 1], [s.user.node, "u0"]));
      expect(view.resume()).toBe(true);
      view = openView();
      view.show(pins([s.a.node, 1]));
      s.a.write(5);
      s.id.write(2);
      flush();
      flushes.length = 0;
      view.resume();
      await tick(30);
      flush();
      expect(s.log.at(-1)).toBe("5/u2");
      expect(flushes.flat()).toContain("a");
      view = openView();
      view.show(pins([s.a.node, 9]));
      view.branch();
      view = undefined;
      expect(s.log.at(-1)).toBe("9/u2");
      expect(codes).toEqual([]);
    } finally {
      off();
      offFlush();
    }
  });

  it("pinning a node that is loading a new question emits no OPTIMISTIC_WRITE_WHILE_LOADING", async () => {
    const codes: string[] = [];
    const off = OBSERVE!.diagnostics.subscribe(e => void codes.push(e.code));
    try {
      const s = root(() => {
        const id = signal(1, "id");
        const user = asyncMemo(id.read, i => `u${i}`);
        return { id, user, log: logOf(() => `${user.read()}`) };
      });
      await tick(30);
      flush();
      s.id.write(2);
      flush();
      view = openView();
      view.show(pins([s.user.node, "u0"]));
      expect(s.log.at(-1)).toBe("u0");
      expect(codes).toEqual([]);
    } finally {
      off();
    }
  });
});
