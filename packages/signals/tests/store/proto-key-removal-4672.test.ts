/**
 * #4672 — a store with own `__proto__` data (JSON rows can carry it) whose
 * data was then removed read `Object.prototype` through the store: a
 * store-wrapped object with 12 own keys, to tracked and untracked readers
 * alike. The key's node had been told the backing's inherited value. Own
 * `constructor` data leaked `Object` the same way.
 *
 * Core R30: inherited pollution keys are never served, so once the own data
 * is gone the read answers what a store that never had it answers
 * (`undefined`). F-10: the change is visible at the flush to every channel,
 * so tracked readers re-run onto it. R12: reading an absent key subscribes,
 * so the reverse direction (absent, then own data lands) reaches tracked
 * readers too. R30 also keeps `__proto__` assignment inert, so a write after
 * the removal neither lands nor pollutes `Object.prototype`.
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

describe("#4672 own pollution-key data removed", () => {
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

  for (const key of ["__proto__", "constructor", "prototype"]) {
    describe(`key ${key}`, () => {
      const removals: Record<string, () => { q: any; remove: () => void }> = {
        reconcile: () => {
          const [q, setQ] = createStore<any>(withOwn(key, 0));
          return { q, remove: () => setQ(reconcile({ id: "a" }, () => undefined) as any) };
        },
        "setter delete": () => {
          const [q, setQ] = createStore<any>(withOwn(key, 0));
          return {
            q,
            remove: () =>
              setQ((s: any) => {
                delete s[key];
              })
          };
        },
        projection: () => {
          const [src, setSrc] = createStore({ has: true });
          const q = createProjection<any>(
            (draft: any) => {
              if (src.has) withOwnOn(draft, key, 0);
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
        "projection (returned value)": () => {
          const [src, setSrc] = createStore({ has: true });
          const q = createProjection<any>(() => (src.has ? withOwn(key, 0) : { id: "a" }), {
            id: "a"
          });
          return {
            q,
            remove: () =>
              setSrc(s => {
                s.has = false;
              })
          };
        },
        "derived store (returned value)": () => {
          const [src, setSrc] = createStore({ has: true });
          const [q] = createStore<any>(() => (src.has ? withOwn(key, 0) : { id: "a" }), {
            id: "a"
          });
          return {
            q,
            remove: () =>
              setSrc(s => {
                s.has = false;
              })
          };
        }
      };

      for (const [path, make] of Object.entries(removals)) {
        it(`${path}: removal reads undefined and tells the tracked reader`, () => {
          const { q, remove } = make();
          const seen = track(() => q[key]);
          expect(q[key]).toBe(0);

          remove();
          flush();

          expect(q[key]).toBeUndefined();
          expect(seen).toEqual([0, undefined]);
          expect(Object.keys(q)).toEqual(["id"]);
        });

        it(`${path}: removal with no tracked reader reads undefined`, () => {
          const { q, remove } = make();
          expect(q[key]).toBe(0);
          remove();
          flush();
          expect(q[key]).toBeUndefined();
        });
      }

      it("reverse: absent, then own data lands through reconcile — tracked readers see it", () => {
        const [q, setQ] = createStore<any>({ id: "a" });
        const seen = track(() => q[key]);
        expect(q[key]).toBeUndefined();

        setQ(reconcile(withOwn(key, 0), () => undefined) as any);
        flush();

        expect(q[key]).toBe(0);
        expect(seen).toEqual([undefined, 0]);
      });

      it("setting it to undefined keeps a present own key (R26), never the inherited value", () => {
        const [q, setQ] = createStore<any>(withOwn(key, 0));
        const seen = track(() => q[key]);
        setQ((s: any) => {
          s[key] = undefined;
        });
        flush();
        // `__proto__` assignment is inert (R30): the own data stays.
        const expected = key === "__proto__" ? 0 : undefined;
        expect(q[key]).toBe(expected);
        expect(seen.at(-1)).toBe(expected);
      });
    });
  }

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

  it("a write after removal: __proto__ stays inert and pollutes nothing; constructor/prototype land as data", () => {
    for (const key of ["__proto__", "constructor", "prototype"]) {
      const [q, setQ] = createStore<any>(withOwn(key, 0));
      const seen = track(() => q[key]);
      setQ((s: any) => {
        delete s[key];
      });
      flush();
      setQ((s: any) => {
        s[key] = { polluted4672: true };
      });
      flush();
      if (key === "__proto__") {
        expect(q[key]).toBeUndefined();
        expect(seen).toEqual([0, undefined]);
      } else {
        expect(q[key]).toEqual({ polluted4672: true });
        expect(seen.at(-1)).toEqual({ polluted4672: true });
      }
      expect(({} as any).polluted4672).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(Object.prototype, "polluted4672")).toBe(false);
    }
  });
});

function withOwnOn(o: any, key: string, value: unknown) {
  Object.defineProperty(o, key, { value, enumerable: true, writable: true, configurable: true });
}
