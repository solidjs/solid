import { describe, expect, it } from "vitest";
import {
  $TARGET,
  $TRACK,
  action,
  createMemo,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush
} from "../../src/index.js";

/**
 * Enumerating a store object does not materialize a presence node per key
 * (#3664).
 *
 * Every enumerator the language offers — `Object.keys`, `for...in`, spread,
 * `Object.entries`, `JSON.stringify` — takes the `getOwnPropertyDescriptor`
 * trap once per key right after `ownKeys`. The descriptor trap became a
 * presence read in 765a65665 (a LONE descriptor read never re-ran for an
 * optimistic add/delete), which was right for that reader but made every
 * enumerator birth one presence node per key of the object: ~640 B and a
 * graph node each, on top of the key-set node `ownKeys` already subscribed
 * it to — and that node bumps on every membership change, committed or
 * optimistic, so the per-key nodes could never tell an enumerator anything
 * new. The trap now skips the presence read when the observer already holds
 * the target's key-set node in the current pass; a lone descriptor read
 * keeps its per-key precision (the structural oracle's descriptor cells).
 *
 * `h` is the target's presence-node cache, `k` its key-set node, `n` its
 * value-node cache; the tests read them off `$TARGET` to pin the shape.
 */

type Row = Record<string, number>;

const never = () => new Promise<never>(() => {});

function nodesOf(proxy: object) {
  const t = (proxy as any)[$TARGET];
  return {
    h: Object.keys(t.h ?? {}),
    k: t.k !== null,
    n: Object.keys(t.n ?? {}),
    kSubs: (() => {
      let c = 0;
      for (let l = t.k?._subs ?? null; l !== null; l = l._nextSub) c++;
      return c;
    })()
  };
}

function row(F: number): Row {
  const r: Row = {};
  for (let f = 0; f < F; f++) r[`f${f}`] = f;
  return r;
}

const ENUMERATORS: Array<[string, (s: Row) => string]> = [
  ["Object.keys", s => Object.keys(s).join(",")],
  [
    "for...in",
    s => {
      const out: string[] = [];
      for (const key in s) out.push(key);
      return out.join(",");
    }
  ],
  ["spread", s => Object.keys({ ...s }).join(",")],
  [
    "Object.entries",
    s =>
      Object.entries(s)
        .map(([k, v]) => `${k}=${v}`)
        .join(",")
  ],
  ["JSON.stringify", s => JSON.stringify(s)]
];

describe("store enumerators subscribe to the key-set node only (#3664)", () => {
  for (const [label, enumerate] of ENUMERATORS) {
    it(`${label} inside a memo births no presence node; adds and deletes re-run it`, () => {
      const [s, set] = createStore<Row>(row(5));
      const runs: string[] = [];
      createRoot(() => {
        const m = createMemo(() => enumerate(s));
        createRenderEffect(
          () => m(),
          v => {
            runs.push(v);
          }
        );
      });
      flush();

      let shape = nodesOf(s);
      expect(shape.h).toEqual([]);
      expect(shape.k).toBe(true);
      expect(shape.kSubs).toBe(1);
      expect(runs).toHaveLength(1);
      expect(runs[0]).toContain("f4");

      set(d => {
        d.f5 = 5;
      });
      flush();
      expect(runs).toHaveLength(2);
      expect(runs[1]).toContain("f5");

      set(d => {
        delete d.f0;
      });
      flush();
      expect(runs).toHaveLength(3);
      expect(runs[2]).not.toContain("f0");

      shape = nodesOf(s);
      expect(shape.h).toEqual([]);
      expect(shape.kSubs).toBe(1);
    });

    it(`${label} inside a render effect births no presence node`, () => {
      const [s] = createStore<Row>(row(30));
      createRoot(() => {
        createRenderEffect(
          () => enumerate(s),
          () => {}
        );
      });
      flush();
      const shape = nodesOf(s);
      expect(shape.h).toEqual([]);
      expect(shape.k).toBe(true);
      expect(shape.kSubs).toBe(1);
    });
  }

  it("value reads that ride the enumeration still get value nodes (spread, entries, stringify)", () => {
    const [s, set] = createStore<Row>(row(3));
    const runs: string[] = [];
    createRoot(() => {
      createRenderEffect(
        () => JSON.stringify(s),
        v => {
          runs.push(v);
        }
      );
    });
    flush();
    const shape = nodesOf(s);
    expect(shape.h).toEqual([]);
    expect(shape.n).toEqual(expect.arrayContaining(["f0", "f1", "f2"])); // (+ the `toJSON` probe)
    set(d => {
      d.f1 = 100;
    });
    flush();
    expect(runs).toEqual(['{"f0":0,"f1":1,"f2":2}', '{"f0":0,"f1":100,"f2":2}']);
  });

  it("one enumerator per row over 1k rows x 30 fields: zero presence nodes", () => {
    const N = 1000;
    const [rows] = createStore<Row[]>(Array.from({ length: N }, () => row(30)));
    createRoot(() => {
      for (let i = 0; i < N; i++) {
        const m = createMemo(() => Object.keys(rows[i]).length);
        createRenderEffect(
          () => m(),
          () => {}
        );
      }
    });
    flush();
    let h = 0;
    let k = 0;
    for (let i = 0; i < N; i++) {
      const shape = nodesOf(rows[i]);
      h += shape.h.length;
      k += shape.k ? 1 : 0;
    }
    expect(h).toBe(0);
    expect(k).toBe(N);
  });

  it("optimistic add and delete re-run an enumerator through the key-set node alone", async () => {
    const [s, set] = createOptimisticStore<Row>({ a: 1 });
    const runs: string[] = [];
    createRoot(() => {
      createRenderEffect(
        () => Object.keys(s).join(","),
        v => {
          runs.push(v);
        }
      );
    });
    flush();
    expect(runs).toEqual(["a"]);

    let release!: () => void;
    const act = action(function* () {
      set(d => {
        d.b = 2;
        delete d.a;
      });
      yield new Promise<void>(r => (release = r));
    });
    const done = act();
    flush();
    // The writer births presence nodes to carry its overrides (`has`
    // births them too); the READER did not subscribe to them.
    expect(runs.at(-1)).toBe("b");
    const t = (s as any)[$TARGET];
    for (const key of Object.keys(t.h ?? {})) {
      let subs = 0;
      for (let l = t.h[key]._subs; l !== null; l = l._nextSub) subs++;
      expect(subs).toBe(0);
    }
    expect(nodesOf(s).kSubs).toBe(1);

    release();
    await done;
    flush();
    // No truth landed: the optimistic structure reverts, and the revert
    // reaches the enumerator through the key-set node as the add did.
    expect(runs.at(-1)).toBe("a");
  });
});

describe("a lone descriptor read keeps its per-key presence node (765a65665)", () => {
  it("births exactly one presence node and no key-set node", () => {
    const [s, set] = createStore<Row>({ a: 1 });
    const runs: boolean[] = [];
    createRoot(() => {
      createRenderEffect(
        () => Object.getOwnPropertyDescriptor(s, "k") !== undefined,
        v => {
          runs.push(v);
        }
      );
    });
    flush();
    let shape = nodesOf(s);
    expect(shape.h).toEqual(["k"]);
    expect(shape.k).toBe(false);
    expect(runs).toEqual([false]);

    set(d => {
      d.k = 5;
    });
    flush();
    expect(runs).toEqual([false, true]);
    // An unrelated key's add is not this reader's business.
    set(d => {
      d.z = 9;
    });
    flush();
    expect(runs).toEqual([false, true]);
    shape = nodesOf(s);
    expect(shape.h).toEqual(["k"]);
    expect(shape.k).toBe(false);
  });

  it("re-runs for an optimistic add and delete of the key (the oracle's descriptor cells)", async () => {
    const [s, set] = createOptimisticStore<Row>({});
    const runs: boolean[] = [];
    createRoot(() => {
      createRenderEffect(
        () => Object.getOwnPropertyDescriptor(s, "k") !== undefined,
        v => {
          runs.push(v);
        }
      );
    });
    flush();
    expect(runs).toEqual([false]);

    action(function* () {
      set(d => {
        d.k = 5;
      });
      yield never();
    })();
    flush();
    expect(runs).toEqual([false, true]);

    const [s2, set2] = createOptimisticStore<Row>({ k: 1 });
    const runs2: boolean[] = [];
    createRoot(() => {
      createRenderEffect(
        () => Object.getOwnPropertyDescriptor(s2, "k") !== undefined,
        v => {
          runs2.push(v);
        }
      );
    });
    flush();
    expect(runs2).toEqual([true]);
    action(function* () {
      set2(d => {
        delete d.k;
      });
      yield never();
    })();
    flush();
    expect(runs2).toEqual([true, false]);
  });
});

describe("the key-set check is scoped to the current pass", () => {
  it("a stale key-set link from a previous pass does not skip the presence read", () => {
    // Run 1 enumerates (links k). Run 2 reads only a descriptor: the link
    // left from run 1 is stale, so the reader must subscribe to `k`'s
    // presence node — or a later add of `k` never re-runs it.
    const [s, set] = createStore<Row>({ a: 1 });
    const [mode, setMode] = createSignal<"keys" | "desc">("keys");
    const runs: number[] = [];
    createRoot(() => {
      const m = createMemo(() =>
        mode() === "keys"
          ? Object.keys(s).length
          : Object.getOwnPropertyDescriptor(s, "k") !== undefined
            ? 1
            : 0
      );
      createRenderEffect(
        () => m(),
        v => {
          runs.push(v);
        }
      );
    });
    flush();
    expect(nodesOf(s).h).toEqual([]);

    setMode("desc");
    flush();
    expect(runs).toEqual([1, 0]);
    expect(nodesOf(s).h).toEqual(["k"]);
    expect(nodesOf(s).kSubs).toBe(0); // the stale link was trimmed

    set(d => {
      d.k = 5;
    });
    flush();
    expect(runs).toEqual([1, 0, 1]);
  });

  it("a same-pass $TRACK read counts as holding the key set", () => {
    const [s, set] = createStore<Row>({ a: 1 });
    const runs: number[] = [];
    createRoot(() => {
      createRenderEffect(
        () => {
          (s as any)[$TRACK];
          return Object.getOwnPropertyDescriptor(s, "k") !== undefined ? 1 : 0;
        },
        v => {
          runs.push(v);
        }
      );
    });
    flush();
    expect(nodesOf(s).h).toEqual([]);
    expect(nodesOf(s).k).toBe(true);

    set(d => {
      d.k = 5;
    });
    flush();
    expect(runs).toEqual([0, 1]);
    set(d => {
      delete d.k;
    });
    flush();
    expect(runs).toEqual([0, 1, 0]);
  });

  it("two readers of one row: each holds k; a third that reads a descriptor alone gets its presence node", () => {
    const [s, set] = createStore<Row>(row(3));
    const runs: string[] = [];
    createRoot(() => {
      createRenderEffect(
        () => Object.keys(s).join(","),
        v => {
          runs.push("A:" + v);
        }
      );
      createRenderEffect(
        () => JSON.stringify(s),
        v => {
          runs.push("B:" + v);
        }
      );
      createRenderEffect(
        () => Object.getOwnPropertyDescriptor(s, "zzz") !== undefined,
        v => {
          runs.push("C:" + v);
        }
      );
    });
    flush();
    const shape = nodesOf(s);
    expect(shape.h).toEqual(["zzz"]);
    expect(shape.kSubs).toBe(2);
    expect(runs).toHaveLength(3);

    set(d => {
      d.zzz = 1;
    });
    flush();
    expect(runs.slice(3).sort()).toEqual([
      "A:f0,f1,f2,zzz",
      'B:{"f0":0,"f1":1,"f2":2,"zzz":1}',
      "C:true"
    ]);
  });
});
