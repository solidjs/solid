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

/** Region test harness on the ENVELOPE CONTRACT: the compute copies the
 * declared keys into the envelope (source order); the commit compares
 * against baselines and records delta frames. The FORCED first commit is
 * the seeding pass (compiled bodies write the DOM there). */
function bindRegion(record: any, keys: string[]) {
  const commits: Record<string, any>[] = [];
  const baseline: Record<string, any> = {};
  const dispose = createRoot(d => {
    region(
      record,
      (t: any, u: any) => {
        for (const k of keys) t[k] = u[k];
      },
      (t: any, _p: any, f: boolean) => {
        if (f) {
          for (const k of keys) baseline[k] = t[k];
          return;
        }
        const frame: Record<string, any> = {};
        let changed = false;
        for (const k of keys) {
          if (t[k] !== baseline[k]) {
            frame[k] = baseline[k] = t[k];
            changed = true;
          }
        }
        if (changed) commits.push(frame);
      }
    );
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

  it("the FIRST commit is forced (initial undefined values still write)", () => {
    createRoot(() => {
      const [state] = createStore<any>({ label: undefined });
      let forced: boolean | null = null;
      region(
        state,
        (t: any, u: any) => {
          t.v = u.label;
        },
        (_t: any, _p: any, f: boolean) => {
          if (forced === null) forced = f;
        }
      );
      expect(forced).toBe(true);
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
      region(
        items[0],
        (t: any, u: any) => {
          t.v = u.label;
        },
        (t: any) => {
          seen.push(t.v);
        }
      );
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
      region(
        state,
        (t: any, u: any) => {
          t.v = u.label;
        },
        (t: any) => {
          seen.push(t.v);
        }
      );
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

  it("PROTOTYPE accessors decline (raw reads would execute them untracked)", () => {
    createRoot(() => {
      class Model {
        base = "a";
        get label() {
          return this.base + "!";
        }
      }
      const [state] = createStore({ row: new Model() } as any);
      const seen: string[] = [];
      region(
        state.row,
        (t: any, u: any) => {
          t.v = u.label;
        },
        (t: any) => {
          seen.push(t.v);
        }
      );
      flush();
      expect((state.row as any)[$TARGET].rg ?? []).toEqual([]); // declined
      expect(seen).toEqual(["a!"]); // classic fallback ran the getter tracked
    });
  });

  it("non-store values run the envelope once and never throw", () => {
    const seen: any[] = [];
    createRoot(() => {
      region(
        { plain: true },
        (t: any, u: any) => {
          t.v = u.plain;
        },
        (t: any) => seen.push(t.v)
      );
      region(
        null,
        () => {},
        () => seen.push("null-commit")
      );
    });
    expect(seen).toEqual([true, "null-commit"]);
  });
});

describe("regions: envelope phases (compiler audit)", () => {
  it("the classic fallback's COMMIT never runs inside the write that woke it", () => {
    createRoot(() => {
      const [state, setState] = createStore({
        get label() {
          return (this as any).base;
        },
        base: "a"
      } as any); // accessor → classic fallback
      const commits: string[] = [];
      region(
        state,
        (t: any, u: any) => {
          t.v = u.label;
        },
        (t: any) => {
          commits.push(t.v);
        }
      );
      flush();
      commits.length = 0;
      setState(s => {
        s.base = "b";
        // Mid-write: the commit must NOT have run synchronously.
        expect(commits).toEqual([]);
      });
      expect(commits).toEqual([]); // pre-flush: still parked
      flush();
      expect(commits).toEqual(["b"]); // effect phase delivered
    });
  });

  it("a held transition masks the classic fallback's commits until release", async () => {
    const [items, setItems] = createRoot(() =>
      (createOptimisticStore as any)([{ id: 1, label: "old" }] as any[])
    );
    const commits: string[] = [];
    createRoot(() => {
      region(
        items[0],
        (t: any, u: any) => {
          t.v = u.label;
        },
        (t: any) => {
          commits.push(t.v);
        }
      );
    });
    flush();
    commits.length = 0;
    let release!: () => void;
    const gate = new Promise<void>(res => (release = res));
    const run = action(function* () {
      setItems((d: any) => {
        d[0].label = "pending";
      });
      yield gate;
    })() as Promise<void>;
    flush();
    await settle();
    // Optimistic lane: the draft IS visible (in-flight visibility) — but
    // only through the effect phase, never synchronously in the write.
    release();
    await run;
    await settle();
    expect(commits.at(-1)).toBe("old"); // reverted optimistic write settles back
  });
});

describe("regions: round-2 audit — timing neutrality (P1-1)", () => {
  it("a NO-OP reconcile never wakes the region (no parked write, no entanglement)", () => {
    createRoot(() => {
      const [state, setState] = createStore({ rows: [{ id: 1, v: "x" }] });
      let wakes = 0;
      region(
        state.rows[0],
        () => {},
        (_t: any, _p: any, f: boolean) => {
          if (!f) wakes++;
        }
      );
      flush();
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
      region(
        state,
        () => {},
        (_t: any, _p: any, f: boolean) => {
          if (!f) wakes++;
        }
      );
      flush();
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
      region(
        state,
        (t: any, u: any) => {
          t.v = u.label;
        },
        (t: any) => {
          seen.push(t.v);
        }
      );
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
      setState(s => {
        s.label = "b";
      });
      flush();
      expect(seen).toContain("b"); // fallback delivering
    });
  });

  it("the demotion REBIND commits in the effect phase, not inside the demoting write", () => {
    createRoot(() => {
      const [state, setState] = createStore<any>({ label: "a" });
      const commits: string[] = [];
      region(
        state,
        (t: any, u: any) => {
          t.v = u.label;
        },
        (t: any) => {
          commits.push(t.v);
        }
      );
      flush();
      commits.length = 0;
      setState(s => {
        Object.defineProperty(s, "computed", {
          get() {
            return "g";
          },
          configurable: true
        });
        s.label = "b";
        // Mid-write: the rebind must not have committed synchronously.
        expect(commits).toEqual([]);
      });
      flush();
      // Post-flush the fallback is live and delivered the new value.
      expect(commits).toContain("b");
    });
  });

  it("demotion rebinds under the MOUNTING owner — disposal still stops the fallback", () => {
    const [state, setState] = createRoot(() => createStore<any>({ label: "a" }));
    const commits: string[] = [];
    const dispose = createRoot(d => {
      region(
        state,
        (t: any, u: any) => {
          t.v = u.label;
        },
        (t: any) => {
          commits.push(t.v);
        }
      );
      return d;
    });
    flush();
    // Demote from OUTSIDE the mounting owner (a plain top-level write).
    setState((s: any) => {
      Object.defineProperty(s, "computed", {
        get() {
          return "g";
        },
        configurable: true
      });
    });
    flush();
    commits.length = 0;
    // The fallback must be owned by the MOUNTING root: disposing it kills
    // delivery even though the rebind happened during an outside write.
    dispose();
    setState((s: any) => {
      s.label = "b";
    });
    flush();
    expect(commits).toEqual([]);
  });

  it("a getter-bearing ADOPTION demotes; the fallback reads THROUGH the getter", () => {
    createRoot(() => {
      const [state, setState] = createStore<any>({ row: { v: 1 } });
      const seen: number[] = [];
      region(
        state.row,
        (t: any, u: any) => {
          t.v = u.v;
        },
        (t: any) => {
          seen.push(t.v);
        }
      );
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
          for (let i = 0; i < state.rows.length; i++) {
            const rec = state.rows[i];
            runWithOwner(gen, () => {
              region(
                rec,
                (t: any, u: any) => {
                  t.id = u.id;
                },
                (t: any) => {
                  commits.push(t.id);
                }
              );
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
    for (let i = 0; i < 50; i++) {
      createRoot(d => {
        region(
          row,
          () => {},
          () => {}
        );
        d();
      });
    }
    const commits: string[] = [];
    createRoot(() => {
      region(
        row,
        (t: any, u: any) => {
          t.v = u.label;
        },
        (t: any) => {
          commits.push(t.v);
        }
      );
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
    createRoot(d => {
      region(
        row,
        (t: any, u: any) => {
          t.v = u.label;
        },
        (t: any) => {
          deadCommits.push(t.v);
        }
      );
      d();
    });
    createRoot(() => {
      region(
        row,
        (t: any, u: any) => {
          t.v = u.label;
        },
        (t: any) => {
          liveCommits.push(t.v);
        }
      );
    });
    createRoot(d => {
      region(
        row,
        (t: any, u: any) => {
          t.v = u.label;
        },
        (t: any) => {
          deadCommits.push(t.v);
        }
      );
      d();
    });
    deadCommits.length = 0;
    liveCommits.length = 0;
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
    expect(liveCommits).toContain("c");
    expect(deadCommits).toEqual([]);
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
