import { describe, expect, it } from "vitest";
import {
  action,
  createOptimisticStore,
  createProjection,
  createRenderEffect,
  createRoot,
  createStore,
  flush,
  reconcile,
  region
} from "../../src/index.js";
import { $TARGET } from "../../src/store/store.js";

const settle = async (n = 3) => {
  for (let i = 0; i < n; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

/** Region test harness on the COMPILED-OUTPUT combinator: scalar baselines
 * seeded from the record BEFORE bind, so region()'s initial commit diffs
 * nothing and `commits` records deltas only (the compiled-body contract —
 * bodies own their baselines and advance them after successful writes). */
function bindRegion(record: any, keys: string[]) {
  const commits: Record<string, any>[] = [];
  const baseline: Record<string, any> = {};
  let primed = false;
  const dispose = createRoot(d => {
    region(record, null, (raw: any) => {
      if (!primed) {
        // The INITIAL commit is the seeding pass (compiled bodies write the
        // DOM here and initialize their baselines from raw identities).
        for (const k of keys) baseline[k] = raw[k];
        primed = true;
        return;
      }
      const frame: Record<string, any> = {};
      let changed = false;
      for (const k of keys) {
        if (raw[k] !== baseline[k]) {
          frame[k] = baseline[k] = raw[k];
          changed = true;
        }
      }
      if (changed) commits.push(frame);
    });
    return d;
  });
  return { dispose, commits, baseline };
}

describe("regions: delivery coverage (audit P1-1)", () => {
  it("a SETTER write delivers the folded raw", () => {
    createRoot(() => {
      const [state, setState] = createStore({ label: "a", count: 1 });
      const r = bindRegion(state, ["label", "count"]);
      setState(s => {
        s.label = "b";
      });
      flush();
      expect(r.commits).toEqual([{ label: "b" }]);
      setState(s => {
        s.count = 2;
        s.label = "c";
      });
      flush();
      expect(r.commits).toEqual([{ label: "b" }, { label: "c", count: 2 }]);
    });
  });

  it("a keyed RECONCILE delivers per changed record", () => {
    createRoot(() => {
      const [state, setState] = createStore({ rows: [{ id: 1, v: "x" }] });
      const r = bindRegion(state.rows[0], ["v"]);
      setState(s => {
        reconcile({ rows: [{ id: 1, v: "y" }] })(s);
      });
      flush();
      expect(r.commits).toEqual([{ v: "y" }]);
    });
  });

  it("a PROJECTION fold commit delivers", () => {
    createRoot(() => {
      const [source, setSource] = createStore({ n: 1 });
      const proj = createProjection((draft: any) => {
        draft.doubled = source.n * 2;
      }, {} as any);
      // Materialize before binding (regions read committed raw).
      void (proj as any).doubled;
      flush();
      const r = bindRegion(proj, ["doubled"]);
      setSource(s => {
        s.n = 5;
      });
      flush();
      expect(r.commits).toEqual([{ doubled: 10 }]);
    });
  });

  it("a ROOT-SLOT replacement delivers on the parent region", () => {
    createRoot(() => {
      const [state, setState] = createStore<any>({ child: { v: 1 }, tag: "t" });
      const r = bindRegion(state, ["child", "tag"]);
      const fresh = { v: 2 };
      setState(s => {
        s.child = fresh;
      });
      flush();
      expect(r.commits.length).toBe(1);
      expect(r.commits[0].child.v).toBe(2);
    });
  });

  it("a VALUE-EQUAL rewrite is a spurious wake, never a wrong commit", () => {
    createRoot(() => {
      const [state, setState] = createStore({ label: "a" });
      const r = bindRegion(state, ["label"]);
      setState(s => {
        s.label = "a";
      });
      flush();
      expect(r.commits).toEqual([]);
    });
  });
});

describe("regions: scheduler-owned timing (audit thesis)", () => {
  it("a TRANSITION parks delivery until its settle", async () => {
    const [state, setState] = createRoot(() => createStore({ label: "old" }));
    const r = createRoot(() => bindRegion(state, ["label"]));
    let release!: () => void;
    const gate = new Promise<void>(res => (release = res));
    const run = action(function* () {
      setState((s: any) => {
        s.label = "new";
      });
      yield gate;
    })() as Promise<void>;
    flush();
    await settle();
    // Mid-flight: the version bump is parked with the key writes.
    expect(r.commits).toEqual([]);
    release();
    await run;
    await settle();
    expect(r.commits).toEqual([{ label: "new" }]);
  });
});

describe("regions: declines take the CLASSIC FALLBACK and still deliver (audit P1-2)", () => {
  it("optimistic-family records decline the raw path but deliver through the proxy", async () => {
    const [items, setItems] = createRoot(() =>
      (createOptimisticStore as any)([{ id: 1, label: "a" }] as any[])
    );
    const seen: string[] = [];
    createRoot(() => {
      // No region node may bind an optimistic record (raw cannot represent
      // overrides) — the SAME body must run as a classic tracked effect.
      region(items[0], null, (raw: any) => {
        seen.push(raw.label);
      });
    });
    flush();
    expect((items[0] as any)[$TARGET].rg ?? []).toEqual([]); // declined
    expect(seen).toEqual(["a"]);
    setItems((d: any) => {
      d[0].label = "b";
    });
    await settle();
    expect(seen).toContain("b"); // classic fallback delivering
  });

  it("accessor-bearing records decline but getters still deliver tracked", () => {
    createRoot(() => {
      const [state, setState] = createStore({
        get label() {
          return (this as any).base + "!";
        },
        base: "a"
      } as any);
      const seen: string[] = [];
      region(state, null, (raw: any) => {
        seen.push(raw.label);
      });
      flush();
      expect((state as any)[$TARGET].rg ?? []).toEqual([]); // declined
      expect(seen).toEqual(["a!"]);
      setState(s => {
        s.base = "b";
      });
      flush();
      expect(seen).toEqual(["a!", "b!"]);
    });
  });

  it("non-store values run the body once and never throw", () => {
    const seen: any[] = [];
    createRoot(() => {
      region({ plain: true }, null, (raw: any) => seen.push(raw.plain));
      region(null, null, () => seen.push("null-body"));
    });
    expect(seen).toEqual([true, "null-body"]);
  });
});

describe("regions: round-2 audit — timing neutrality (P1-1)", () => {
  it("a NO-OP reconcile never wakes the region (no parked write, no entanglement)", () => {
    createRoot(() => {
      const [state, setState] = createStore({ rows: [{ id: 1, v: "x" }] });
      let wakes = 0;
      region(state.rows[0], null, () => {
        wakes++;
      });
      flush();
      wakes = 0; // discount the initial commit
      // Equal values, fresh object — the adoption swaps the backing but no
      // value changed: the version node must not be written at all.
      setState(s => {
        reconcile({ rows: [{ id: 1, v: "x" }] })(s);
      });
      flush();
      expect(wakes).toBe(0);
    });
  });

  it("a VALUE-EQUAL setter rewrite never wakes the region", () => {
    createRoot(() => {
      const [state, setState] = createStore({ label: "a" });
      let wakes = 0;
      region(state, null, () => {
        wakes++;
      });
      flush();
      wakes = 0;
      setState(s => {
        s.label = "a";
      });
      flush();
      expect(wakes).toBe(0);
    });
  });
});

describe("regions: round-2 audit — durable admission (P1-2)", () => {
  it("defineProperty getter DEMOTES: the region dies and the classic fallback takes over", () => {
    createRoot(() => {
      const [state, setState] = createStore<any>({ label: "a" });
      const seen: string[] = [];
      region(state, null, (raw: any) => {
        seen.push(raw.label);
      });
      flush();
      expect((state as any)[$TARGET].rg.length).toBe(1); // admitted
      setState(s => {
        Object.defineProperty(s, "computed", {
          get() {
            return "g";
          },
          configurable: true
        });
      });
      flush();
      expect((state as any)[$TARGET].rg).toBe(undefined); // demoted
      seen.length = 0;
      // The fallback delivers subsequent writes with correct values.
      setState(s => {
        s.label = "b";
      });
      flush();
      expect(seen).toContain("b");
    });
  });

  it("a getter-bearing ADOPTION demotes; the fallback reads THROUGH the getter", () => {
    createRoot(() => {
      const [state, setState] = createStore<any>({ row: { v: 1 } });
      const seen: number[] = [];
      region(state.row, null, (raw: any) => {
        seen.push(raw.v);
      });
      flush();
      seen.length = 0;
      setState(s => {
        reconcile({
          row: {
            get v() {
              return 2;
            }
          }
        } as any)(s);
      });
      flush();
      // Never a lying raw frame: whatever delivered post-demotion came
      // through the tracked path and saw the getter's value.
      expect(seen.every(v => v === 2)).toBe(true);
      expect(seen).toContain(2);
    });
  });
});

describe("regions: round-2 audit — owned rows (P1-4)", () => {
  it("rows created under a GENERATION OWNER inside a list commit dispose in one owner walk", async () => {
    const { createOwner, runWithOwner, disposeChildren, $TRACK } =
      await import("../../src/index.js");
    const [state, setState] = createRoot(() => createStore({ rows: [{ id: 1 }, { id: 2 }] }));
    const gen = createRoot(() => createOwner());
    const commits: number[] = [];
    createRoot(() => {
      createRenderEffect(
        () => {
          (state.rows as any)[$TRACK];
        },
        () => {
          // Rows bind INSIDE the list commit, under the generation owner —
          // the audit's blocked shape, unblocked.
          for (let i = 0; i < state.rows.length; i++) {
            const rec = state.rows[i];
            runWithOwner(gen, () => {
              region(rec, null, (raw: any) => {
                commits.push(raw.id);
              });
            });
          }
        }
      );
    });
    flush();
    setState(s => {
      s.rows[0].id = 10;
    });
    flush();
    expect(commits).toContain(10);
    const before = commits.length;
    // BULK teardown: one owner walk kills every row region.
    disposeChildren(gen as any);
    setState(s => {
      s.rows[0].id = 99;
      s.rows[1].id = 98;
    });
    flush();
    expect(commits.length).toBe(before);
  });
});

describe("regions: lifecycle (audit correction — owner-bound)", () => {
  it("explicit dispose stops delivery", () => {
    createRoot(() => {
      const [state, setState] = createStore({ label: "a" });
      const r = bindRegion(state, ["label"]);
      r.dispose();
      setState(s => {
        s.label = "b";
      });
      flush();
      expect(r.commits).toEqual([]);
    });
  });

  it("region() remount churn keeps the registry bounded (amortized sweep)", () => {
    const [state, setState] = createRoot(() => createStore({ row: { id: 1, label: "a" } }));
    const row = state.row;
    // 50 mount/dispose cycles on the SAME record — dead entries must be
    // swept on each subsequent push, not accumulate retaining closures.
    for (let i = 0; i < 50; i++) {
      createRoot(d => {
        region(row, null, () => {});
        d();
      });
    }
    const commits: string[] = [];
    createRoot(() => {
      region(row, null, (raw: any) => {
        commits.push(raw.label);
      });
    });
    const rg = (row as any)[$TARGET].rg;
    expect(rg.length).toBeLessThanOrEqual(2); // live + at most one dead
    setState(s => {
      s.row.label = "b";
    });
    flush();
    expect(commits).toEqual(["a", "b"]);
  });

  it("demotion skips DEAD entries — no resurrected classic fallback for unmounted views", () => {
    const [state, setState] = createRoot(() => createStore({ row: { id: 1, label: "a" } }));
    const row = state.row;
    const deadCommits: string[] = [];
    const liveCommits: string[] = [];
    // Mount and dispose a region (dead entry lingers until next sweep).
    createRoot(d => {
      region(row, null, (raw: any) => {
        deadCommits.push(raw.label);
      });
      d();
    });
    // A live one beside it. Its push sweeps the dead entry too, so re-add
    // a dead one AFTER to exercise the demotion-time guard.
    createRoot(() => {
      region(row, null, (raw: any) => {
        liveCommits.push(raw.label);
      });
    });
    createRoot(d => {
      region(row, null, (raw: any) => {
        deadCommits.push(raw.label);
      });
      d();
    });
    deadCommits.length = 0;
    liveCommits.length = 0;
    // Accessor acquisition demotes: live regions rebind classic; the dead
    // entry must stay dead.
    setState(s => {
      Object.defineProperty(s.row, "computed", {
        get() {
          return this.label + "!";
        },
        configurable: true
      });
    });
    flush();
    setState(s => {
      s.row.label = "c";
    });
    flush();
    expect(liveCommits).toContain("c"); // classic fallback delivering
    expect(deadCommits).toEqual([]); // unmounted view stayed unmounted
  });

  it("OWNER disposal stops delivery (regions are owner-bound)", () => {
    const [state, setState] = createRoot(() => createStore({ label: "a" }));
    let r!: ReturnType<typeof bindRegion>;
    const dispose = createRoot(d => {
      r = bindRegion(state, ["label"]);
      return d;
    });
    dispose();
    setState(s => {
      s.label = "b";
    });
    flush();
    expect(r.commits).toEqual([]);
  });
});
