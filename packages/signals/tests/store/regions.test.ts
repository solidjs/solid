import { describe, expect, it } from "vitest";
import {
  action,
  createOptimisticStore,
  createProjection,
  createRegion,
  createRoot,
  createStore,
  disposeReactiveNode,
  flush,
  reconcile
} from "../../src/index.js";

const settle = async (n = 3) => {
  for (let i = 0; i < n; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

/** Region test harness: bind a region with scalar baselines (the compiled-
 * body contract — commit(raw) ONLY; bodies own their baselines and advance
 * them after successful writes). */
function bindRegion(record: any, keys: string[]) {
  const commits: Record<string, any>[] = [];
  const baseline: Record<string, any> = {};
  for (const k of keys) baseline[k] = (record as any)[k];
  const node = createRegion(record, (raw: any) => {
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
  return { node, commits, baseline };
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

describe("regions: declines (audit P1-2)", () => {
  it("optimistic-family records decline (raw cannot represent overrides)", () => {
    createRoot(() => {
      const [items] = (createOptimisticStore as any)([{ id: 1 }] as any[]);
      expect(createRegion(items[0], () => {})).toBe(null);
    });
  });

  it("accessor-bearing records decline (raw reads would run getters untracked)", () => {
    createRoot(() => {
      const [state] = createStore({
        get label() {
          return "computed";
        },
        plain: 1
      } as any);
      expect(createRegion(state, () => {})).toBe(null);
    });
  });

  it("non-store values decline", () => {
    expect(createRegion({ plain: true }, () => {})).toBe(null);
    expect(createRegion(null, () => {})).toBe(null);
  });
});

describe("regions: lifecycle (audit correction — owner-bound)", () => {
  it("explicit dispose stops delivery", () => {
    createRoot(() => {
      const [state, setState] = createStore({ label: "a" });
      const r = bindRegion(state, ["label"]);
      disposeReactiveNode(r.node);
      setState(s => {
        s.label = "b";
      });
      flush();
      expect(r.commits).toEqual([]);
    });
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
