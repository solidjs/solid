/**
 * #4672 — a store with own `__proto__` data (JSON rows can carry it) whose
 * data was then removed read `Object.prototype` through the store: a
 * store-wrapped object with 12 own keys, to tracked and untracked readers
 * alike. The key's node had been told the backing's inherited value.
 *
 * Core R30: an inherited `__proto__` is never served, so once the own data is
 * gone the read answers what a store that never had it answers: `undefined`.
 * F-10: the change is visible at the flush to every channel, so tracked
 * readers re-run onto it. R30 also keeps `__proto__` assignment inert, so a
 * write after the removal neither lands nor pollutes `Object.prototype`.
 */
import { describe, expect, it } from "vitest";
import {
  createProjection,
  createRenderEffect,
  createRoot,
  createStore,
  flush,
  reconcile
} from "../../src/index.js";

const withOwn = (key: string, value: unknown, base: Record<string, unknown> = { id: "a" }) => {
  const o: any = { ...base };
  Object.defineProperty(o, key, { value, enumerable: true, writable: true, configurable: true });
  return o;
};

function track(read: () => unknown) {
  const seen: unknown[] = [];
  createRoot(() =>
    createRenderEffect(read, v => {
      seen.push(v);
    })
  );
  flush();
  return seen;
}

const removals: Record<string, (key: string) => { q: any; remove: () => void }> = {
  reconcile: key => {
    const [q, setQ] = createStore<any>(withOwn(key, 0));
    return { q, remove: () => setQ(reconcile({ id: "a" }, () => undefined) as any) };
  },
  "setter delete": key => {
    const [q, setQ] = createStore<any>(withOwn(key, 0));
    return {
      q,
      remove: () =>
        setQ((s: any) => {
          delete s[key];
        })
    };
  },
  "projection draft delete": key => {
    const [src, setSrc] = createStore({ has: true });
    const q = createProjection<any>(
      (draft: any) => {
        if (src.has)
          Object.defineProperty(draft, key, {
            value: 0,
            enumerable: true,
            writable: true,
            configurable: true
          });
        else delete draft[key];
      },
      withOwn(key, 0)
    );
    return {
      q,
      remove: () =>
        setSrc(s => {
          s.has = false;
        })
    };
  },
  "projection returned value": key => {
    const [src, setSrc] = createStore({ has: true });
    const q = createProjection<any>(() => (src.has ? withOwn(key, 0) : { id: "a" }), { id: "a" });
    return {
      q,
      remove: () =>
        setSrc(s => {
          s.has = false;
        })
    };
  },
  "derived store returned value": key => {
    const [src, setSrc] = createStore({ has: true });
    const [q] = createStore<any>(() => (src.has ? withOwn(key, 0) : { id: "a" }), { id: "a" });
    return {
      q,
      remove: () =>
        setSrc(s => {
          s.has = false;
        })
    };
  }
};

describe("#4672 own __proto__ data removed", () => {
  it("the issue's repro: reconcile removal reads undefined, tracked and untracked", () => {
    const [q, setQ] = createStore<any>(withOwn("__proto__", 0));
    const seen = track(() => q["__proto__"]);
    expect(q["__proto__"]).toBe(0);
    expect(seen).toEqual([0]);

    setQ(reconcile({ id: "a" }, () => undefined) as any);
    flush();

    expect(q["__proto__"]).toBeUndefined();
    expect(seen).toEqual([0, undefined]);
    expect(Object.keys(q)).toEqual(["id"]);
  });

  it("matches a store that never had own __proto__ data", () => {
    const [never] = createStore<any>({ id: "a" });
    const seen = track(() => never["__proto__"]);
    expect(never["__proto__"]).toBeUndefined();
    expect(seen).toEqual([undefined]);
  });

  for (const [path, make] of Object.entries(removals)) {
    it(`${path}: reads undefined and tells the tracked reader`, () => {
      const { q, remove } = make("__proto__");
      const seen = track(() => q["__proto__"]);
      expect(q["__proto__"]).toBe(0);
      remove();
      flush();
      expect(q["__proto__"]).toBeUndefined();
      expect(seen).toEqual([0, undefined]);
      expect(Object.keys(q)).toEqual(["id"]);
    });

    it(`${path}: with no tracked reader reads undefined`, () => {
      const { q, remove } = make("__proto__");
      expect(q["__proto__"]).toBe(0);
      remove();
      flush();
      expect(q["__proto__"]).toBeUndefined();
    });
  }

  it("setting it to undefined is inert (R30): the own data stays", () => {
    const [q, setQ] = createStore<any>(withOwn("__proto__", 0));
    const seen = track(() => q["__proto__"]);
    setQ((s: any) => {
      s["__proto__"] = undefined;
    });
    flush();
    expect(q["__proto__"]).toBe(0);
    expect(seen).toEqual([0]);
  });

  it("a write after removal stays inert and pollutes nothing", () => {
    const [q, setQ] = createStore<any>(withOwn("__proto__", 0));
    const seen = track(() => q["__proto__"]);
    setQ((s: any) => {
      delete s["__proto__"];
    });
    flush();
    setQ((s: any) => {
      s["__proto__"] = { polluted4672: true };
    });
    flush();
    expect(q["__proto__"]).toBeUndefined();
    expect(seen).toEqual([0, undefined]);
    expect(({} as any).polluted4672).toBeUndefined();
  });

  it("a wide record (overlay pending backing): own __proto__ survives sibling writes, then removal reads undefined", () => {
    const base: Record<string, unknown> = {};
    for (let i = 0; i < 40; i++) base["k" + i] = i;
    const [q, setQ] = createStore<any>(withOwn("__proto__", 0, base));
    const seen = track(() => [q["__proto__"], q.k1]);
    for (let r = 0; r < 3; r++) {
      setQ((s: any) => {
        s.k1 = 100 + r;
      });
      flush();
    }
    expect(q["__proto__"]).toBe(0);
    setQ((s: any) => {
      delete s["__proto__"];
      s.k2 = 5;
    });
    flush();
    expect(q["__proto__"]).toBeUndefined();
    setQ((s: any) => {
      s.k3 = 5;
    });
    flush();
    expect(q["__proto__"]).toBeUndefined();
    expect(seen.map((v: any) => v[0])).toEqual([0, 0, 0, 0, undefined]);
  });

  // The reverse direction is outside #4672: a tracked reader of an absent
  // `__proto__` gets no node (the get trap answers it before subscribing), so
  // own data landing later reaches untracked reads only. Pinned as it stands.
  it("reverse, untracked: own __proto__ data landing reads as data", () => {
    const [q, setQ] = createStore<any>({ id: "a" });
    setQ(reconcile(withOwn("__proto__", 0), () => undefined) as any);
    flush();
    expect(q["__proto__"]).toBe(0);
  });

  it.fails("reverse, tracked: own __proto__ data landing reaches the tracked reader (R12)", () => {
    const [q, setQ] = createStore<any>({ id: "a" });
    const seen = track(() => q["__proto__"]);
    setQ(reconcile(withOwn("__proto__", 0), () => undefined) as any);
    flush();
    expect(seen).toEqual([undefined, 0]);
  });

  // Pins for the sibling keys (#4674 ruling): a removed own `constructor`
  // reads the inherited class, as an object that never had one does; own
  // `prototype` data never leaked (no built-in prototype has one).
  it("pin: a removed own constructor reads the inherited class", () => {
    const { q, remove } = removals.reconcile("constructor");
    const seen = track(() => q.constructor);
    remove();
    flush();
    expect(q.constructor).toBe(Object);
    expect(seen).toEqual([0, Object]);
  });

  it("pin: a removed own prototype reads undefined", () => {
    const { q, remove } = removals["setter delete"]("prototype");
    const seen = track(() => q.prototype);
    remove();
    flush();
    expect(q.prototype).toBeUndefined();
    expect(seen).toEqual([0, undefined]);
  });
});
