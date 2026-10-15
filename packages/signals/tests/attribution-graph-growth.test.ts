/**
 * GRAPH_GROWTH — the live graph counted at each navigation's settle.
 *
 * Claim under test: the observe core keeps the top-level roots (weakly) and
 * counts the owner tree from them on request; the engine asks at a
 * navigation's settle and emits a `graph` record, and when the count at the
 * same route climbs on `visits` consecutive settles to `ratio`× the first,
 * GRAPH_GROWTH names the route with the counts. A route whose visits clean
 * up after themselves stays quiet; nothing is charged per node.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { attribution, graphSize } from "../src/attribution.js";
import type { GraphEvent, GraphSize, NavigationEvent } from "../src/attribution.js";
import {
  createEffect,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  getOwner,
  OBSERVE,
  runWithOwner,
  untrack
} from "../src/index.js";
import type { Accessor, Owner } from "../src/index.js";
import type { DiagnosticEvent, RecordListener, RecordType } from "../src/core/dev.js";

// The engine's records arrive on the channel, whose subscriptions are the
// consumer's — not dropped by `disable()` — so each test's are released here.
const offs: (() => void)[] = [];
function on<K extends RecordType>(type: K, listener: RecordListener<K>): void {
  offs.push(OBSERVE!.records.subscribe(type, listener));
}

afterEach(() => {
  for (const off of offs.splice(0)) off();
  attribution.disable();
  flush();
  vi.restoreAllMocks();
});

function arm(graphGrowth: { visits: number; ratio: number } | false = { visits: 3, ratio: 1.25 }) {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  attribution.enable({
    log: false,
    hotRuns: false,
    hotTime: false,
    waterfalls: false,
    graphGrowth
  });
  const graphs: GraphEvent[] = [];
  on("graph", e => graphs.push(e));
  const navigations: NavigationEvent[] = [];
  on("navigation", e => navigations.push(e));
  const findings: DiagnosticEvent[] = [];
  OBSERVE!.diagnostics.subscribe(e => {
    if (e.code === "GRAPH_GROWTH") findings.push(e);
  });
  return { graphs, navigations, findings, warn };
}

/**
 * An app root with a location and a synchronous page. `leak: "root"` mounts
 * a root per visit that nobody disposes; `leak: "ownerless"` creates an
 * effect per visit with no owner at all — no chain holds it, only the
 * long-lived `shared` signal it reads.
 */
function app(leak: false | "root" | "ownerless") {
  const [location, setLocation] = createSignal("/", { name: "location" });
  const [shared] = createSignal(0, { name: "shared" });
  const leaked: (() => void)[] = [];
  const dispose = createRoot(dispose => {
    const page = createMemo(() => location(), { name: "page" });
    // The app reads `shared` too: that is how the walk reaches it, and through
    // its subscriber list the effects nobody owns.
    createEffect(shared, () => {}, { name: "sharedReader" });
    // The leaks happen in the pass that mounts the route (a component body
    // detaching work from its owner), where creating computations is legal;
    // in the effect callback the same code trips PRIMITIVE_IN_EFFECT_CALLBACK
    // before GRAPH_GROWTH ever sees a graph.
    createEffect(
      () => {
        const route = page();
        if (route !== "/orders" || leak === false) return route;
        runWithOwner(null, () => {
          if (leak === "root") {
            // The mistake: a detached root per visit, never disposed.
            createRoot(d => {
              leaked.push(d);
              const [n] = createSignal(0);
              createEffect(n, () => {});
              createMemo(() => n() + 1);
            });
          } else {
            // The other mistake: an effect with no owner, kept alive by `shared`.
            createEffect(shared, () => {});
          }
        });
        return route;
      },
      () => {},
      { name: "mount" }
    );
    return dispose;
  });
  flush();
  return { setLocation, dispose, leaked };
}

function navigate(setLocation: (v: string) => void, to: string, name = to) {
  OBSERVE!.attribution.withOrigin({ kind: "navigation", name, to }, () => setLocation(to));
  flush();
}

describe("graphSize()", () => {
  it("counts the owner tree, then the computations, signals and edges it reaches", () => {
    const before = graphSize();
    const dispose = createRoot(dispose => {
      const [a] = createSignal(0);
      const b = createMemo(() => a());
      createEffect(b, () => {});
      createRoot(() => createMemo(() => a()));
      return dispose;
    });
    flush();
    const during = graphSize();
    expect(during.roots).toBe(before.roots + 1);
    // root + memo + effect (its compute node) + the owned nested root + its memo.
    expect(during.owners - before.owners).toBeGreaterThanOrEqual(4);
    // b, the effect's compute, the nested memo (at least).
    expect(during.computations - before.computations).toBeGreaterThanOrEqual(3);
    // `a`, reached through b's dependency.
    expect(during.signals - before.signals).toBeGreaterThanOrEqual(1);
    // b←a, effect←b, nested←a.
    expect(during.edges - before.edges).toBeGreaterThanOrEqual(3);
    dispose();
    const after = graphSize();
    expect(after).toEqual(before);
  });

  it("finds a computation no owner holds, through the source that keeps it alive", () => {
    const [s] = createSignal(0, { name: "s" });
    const dispose = createRoot(dispose => {
      createEffect(s, () => {});
      return dispose;
    });
    flush();
    const owned = graphSize();
    runWithOwner(null, () => {
      createEffect(s, () => {});
    });
    flush();
    const withOrphan = graphSize();
    // The orphan is not in any owner chain…
    expect(withOrphan.owners).toBe(owned.owners);
    // …but `s` is reached from the owned effect, and the orphan reads `s`.
    expect(withOrphan.computations).toBe(owned.computations + 1);
    expect(withOrphan.edges).toBe(owned.edges + 1);
    dispose();
  });
});

describe("GRAPH_GROWTH", () => {
  it.each([false, true])(
    "keeps initial declarations out of visit comparisons (retained roots: %s)",
    leak => {
      const before = graphSize();
      const { graphs, navigations, findings } = arm();
      const detached: (() => void)[] = [];
      const [location, setLocation] = createSignal("/a");
      let rowCount = 100;
      const rows = () => {
        const [value] = createSignal(1);
        for (let i = 0; i < rowCount; i++) {
          const row = createMemo(() => value() + i);
          untrack(row);
        }
      };
      const dispose = createRoot(dispose => {
        // The router declares its initial match before mounting route content.
        OBSERVE!.attribution.withOrigin(
          { kind: "navigation", initial: true, name: "/a", to: "/a" },
          () => {}
        );
        const page = createMemo(() => {
          const route = location();
          if (route === "/a") rows();
          return route;
        });
        createEffect(page, () => {});
        return dispose;
      });
      const retainRoot = () =>
        createRoot(dispose => {
          detached.push(dispose);
          rows();
        });
      try {
        flush();
        if (leak) retainRoot();
        for (const count of [101, 102, 103]) {
          // Let /a complete three visits before any other route can report growth.
          navigate(setLocation, leak && count === 101 ? "/c" : "/b");
          if (!leak) rowCount = count;
          navigate(setLocation, "/a");
          if (leak) retainRoot();
        }
        expect(graphs).toHaveLength(7);
        expect(navigations).toHaveLength(7);
        expect(graphs[0]).toMatchObject({ route: "/a", navigation: { initial: true } });
        expect(graphs[0].navigation).toBe(navigations[0]);
        const visits = graphs.filter(g => g.route === "/a" && !g.navigation.initial);
        expect(visits).toHaveLength(3);
        const away = graphs.filter(g => g.route === "/b");
        const counts = ({ roots, owners, computations, signals, edges }: GraphEvent) => ({
          roots,
          owners,
          computations,
          signals,
          edges
        });
        if (leak) {
          expect(away).toHaveLength(2);
          expect(visits[2].roots).toBe(visits[0].roots + 2);
          expect(findings).toHaveLength(1);
          expect(findings[0].data).toMatchObject({
            route: "/a",
            history: visits.map(counts)
          });
        } else {
          expect(away.map(counts)).toEqual([counts(away[0]), counts(away[0]), counts(away[0])]);
          expect(visits.map(g => g.computations - visits[0].computations)).toEqual([0, 1, 2]);
          expect(findings).toHaveLength(0);
        }
      } finally {
        dispose();
        for (const dispose of detached) dispose();
        flush();
      }
      expect(graphSize()).toEqual(before);
    }
  );

  it("emits a graph record per settled navigation, with the route and the counts", () => {
    const { graphs, navigations } = arm(false);
    const { setLocation, dispose } = app(false);
    navigate(setLocation, "/orders");
    navigate(setLocation, "/", "/");
    expect(graphs).toHaveLength(2);
    expect(graphs[0]).toMatchObject({ route: "/orders", navigation: navigations[0] });
    expect(graphs[0].owners).toBeGreaterThan(0);
    expect(graphs[0].roots).toBeGreaterThanOrEqual(1);
    expect(graphs[0].at).toBeGreaterThanOrEqual(navigations[0].at);
    dispose();
  });

  it("warns when the count at the same route climbs on consecutive visits", () => {
    const { findings, warn } = arm({ visits: 3, ratio: 1.25 });
    const { setLocation, dispose, leaked } = app("root");
    for (let i = 0; i < 3; i++) {
      navigate(setLocation, "/orders");
      navigate(setLocation, "/", "/");
    }
    expect(leaked).toHaveLength(3);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ code: "GRAPH_GROWTH", kind: "perf", severity: "warn" });
    const data = findings[0].data as {
      route: string;
      grew: string[];
      history: { owners: number }[];
      routes: string[];
    };
    // The count is the graph's: the first route to complete its climb reports, naming the others.
    expect(data.route).toBe("/orders");
    expect(data.routes).toEqual(["/orders", "/"]);
    expect(data.grew).toContain("owners");
    expect(data.history).toHaveLength(3);
    expect(data.history[1].owners).toBeGreaterThan(data.history[0].owners);
    expect(data.history[2].owners).toBeGreaterThan(data.history[1].owners);
    expect(findings[0].message).toContain("3 consecutive visits to /orders");
    expect(findings[0].message).toContain("createRoot()");
    expect(warn).toHaveBeenCalled();
    // Judged once; another three climbing visits are needed before it speaks again.
    navigate(setLocation, "/orders");
    navigate(setLocation, "/", "/");
    expect(findings).toHaveLength(1);
    for (const d of leaked) d();
    dispose();
  });

  it("an ownerless effect per visit grows computations and edges while owners stay flat", () => {
    const { findings } = arm({ visits: 3, ratio: 1.25 });
    const { setLocation, dispose } = app("ownerless");
    for (let i = 0; i < 3; i++) {
      navigate(setLocation, "/orders");
      navigate(setLocation, "/", "/");
    }
    expect(findings).toHaveLength(1);
    const data = findings[0].data as { grew: string[]; history: { owners: number }[] };
    expect(data.grew).toContain("computations");
    expect(data.grew).toContain("edges");
    expect(data.grew).not.toContain("owners");
    expect(new Set(data.history.map(h => h.owners)).size).toBe(1);
    expect(findings[0].message).toContain("no owner");
    dispose();
  });

  it("a route whose visits clean up after themselves stays quiet", () => {
    const { findings, graphs } = arm({ visits: 3, ratio: 1.25 });
    const { setLocation, dispose } = app(false);
    for (let i = 0; i < 4; i++) {
      navigate(setLocation, "/orders");
      navigate(setLocation, "/", "/");
    }
    const orders = graphs.filter(g => g.route === "/orders").map(g => g.owners);
    expect(new Set(orders).size).toBe(1);
    expect(findings).toHaveLength(0);
    dispose();
  });

  it.each([false, true])(
    "a navigation held for its data counts the graph after the landing disposes the page left (#3989, leak: %s)",
    async leak => {
      const { findings, graphs } = arm({ visits: 3, ratio: 1.25 });
      const [shared] = createSignal(0, { name: "shared" });
      const [location, setLocation] = createSignal("/", { name: "location" });
      const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
      const detached: (() => void)[] = [];
      // A big page: rows reading the long-lived signal, so its parked frame is
      // reachable through `shared`'s subscribers until the landing disposes it.
      const rows = (n: number) => () => {
        const list = Array.from({ length: n }, () => createMemo(() => shared()));
        return () => list.reduce((sum, row) => sum + row(), 0);
      };
      // The small page fetches on every visit, so its arrival is held.
      const small = () => {
        // The positive control: a detached root per visit that nobody disposes.
        if (leak)
          runWithOwner(null, () =>
            createRoot(d => {
              detached.push(d);
              for (let i = 0; i < 10; i++) createMemo(() => shared());
            })
          );
        const data = createMemo(async () => (await wait(2), 1));
        return () => data() + shared();
      };
      const pages: Record<string, () => () => unknown> = { "/small": small };
      for (const n of [20, 40, 80]) pages[`/rows-${n}`] = rows(n);
      const dispose = createRoot(dispose => {
        const page = createMemo(() => {
          const mount = pages[location()];
          return mount ? untrack(mount) : () => null;
        });
        createRenderEffect(
          () => page()(),
          () => {}
        );
        return dispose;
      });
      flush();
      const go = async (to: string) => {
        OBSERVE!.attribution.withOrigin({ kind: "navigation", name: to, to }, () =>
          setLocation(to)
        );
        flush();
        await wait(10);
        flush();
        return graphSize().computations;
      };
      const after: number[] = [];
      for (const n of [20, 40, 80]) {
        await go(`/rows-${n}`);
        after.push(await go("/small"));
      }
      const settles = graphs.filter(g => g.route === "/small");
      expect(settles.map(g => g.navigation.outcome)).toEqual(["held", "held", "held"]);
      // The settle sees the graph the route settled into, not the page just left.
      expect(settles.map(g => g.computations)).toEqual(after);
      if (leak) {
        expect(after.map(c => c - after[0])).toEqual([0, 10, 20]);
        expect(findings).toHaveLength(1);
        expect(findings[0].data).toMatchObject({ route: "/small" });
      } else {
        expect(new Set(after).size).toBe(1);
        expect(findings).toHaveLength(0);
      }
      dispose();
      for (const d of detached) d();
      flush();
    }
  );

  it("`false` disables the check, and without a listener no walk is made", () => {
    const { findings, graphs } = arm(false);
    // No graph listener from here on: drop ours and re-enable without one.
    attribution.disable();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    attribution.enable({ log: false, graphGrowth: false });
    const diag: DiagnosticEvent[] = [];
    OBSERVE!.diagnostics.subscribe(e => {
      if (e.code === "GRAPH_GROWTH") diag.push(e);
    });
    const { setLocation, dispose, leaked } = app("root");
    for (let i = 0; i < 4; i++) {
      navigate(setLocation, "/orders");
      navigate(setLocation, "/", "/");
    }
    expect(diag).toHaveLength(0);
    expect(findings).toHaveLength(0);
    void graphs;
    for (const d of leaked) d();
    dispose();
  });

  /**
   * The routes of #4007: a memo owns the current page's rows and a render
   * effect reads them. A, C and D only change how much correctly owned
   * content each visit has; B, E and F also leave a detached root behind on
   * every `/rows/:count` visit.
   */
  type Variant = "A" | "B" | "C" | "D" | "E" | "F";
  function visits(variant: Variant) {
    const leak = variant === "B" || variant === "E" || variant === "F";
    const leaked: (() => void)[] = [];
    const [location, setLocation] = createSignal({ rows: false, count: 0 });
    const [shared] = createSignal(1);
    const dispose = createRoot(dispose => {
      const page = createMemo(() => {
        const current = location();
        const n = current.count;
        if (n === 0) return shared;
        if (current.rows && leak)
          runWithOwner(null, () =>
            createRoot(dispose => {
              leaked.push(dispose);
              createRenderEffect(shared, () => {});
            })
          );
        const rows = Array.from({ length: n }, () => createMemo(shared));
        return () => rows.reduce((sum, row) => sum + row(), 0);
      });
      createRenderEffect(
        () => page()(),
        () => {}
      );
      return dispose;
    });
    flush();
    const counts = variant === "F" ? [5, 3, 1] : [1, 3, 5];
    counts.forEach((n, index) => {
      OBSERVE!.attribution.withOrigin(
        { kind: "navigation", name: "/rows/:count", to: `/rows/${n}`, params: { count: `${n}` } },
        () => setLocation({ rows: true, count: n })
      );
      flush();
      if (variant === "C") return;
      const other = variant === "D" ? n : variant === "E" ? [101, 51, 1][index] : 0;
      OBSERVE!.attribution.withOrigin(
        {
          kind: "navigation",
          name: other ? "/other/:count" : "/rest",
          to: other ? `/other/${other}` : "/rest"
        },
        () => setLocation({ rows: false, count: other })
      );
      flush();
    });
    return () => {
      dispose();
      for (const d of leaked) d();
      flush();
    };
  }

  it.each([
    ["A", "growing content, a fixed route between visits"],
    ["C", "growing content, consecutive parameter changes"],
    ["D", "both routes' content grows"]
  ] as const)(
    "content that differs per visit but is disposed on leaving does not report (%s: %s)",
    (variant, _) => {
      const before = graphSize();
      const { findings, graphs } = arm();
      const cleanup = visits(variant);
      try {
        // The totals at the arrivals really climb — the page has more rows each time…
        const rows = graphs.filter(g => g.route === "/rows/:count").map(g => g.owners);
        expect(rows).toHaveLength(3);
        expect(rows[1]).toBeGreaterThan(rows[0]);
        expect(rows[2]).toBeGreaterThan(rows[1]);
        // …but nothing a visit created outlived the navigation away from it.
        expect(findings).toHaveLength(0);
      } finally {
        cleanup();
      }
      expect(graphSize()).toEqual(before);
    }
  );

  it.each([
    ["B", "a root per visit", "/rows/:count"],
    ["E", "a root per visit while the intervening content shrinks", "/rows/:count"],
    ["F", "a root per visit while its own content shrinks", "/rest"]
  ] as const)("a root each visit leaves behind still reports (%s: %s)", (variant, _, route) => {
    const before = graphSize();
    const { findings } = arm();
    const cleanup = visits(variant);
    try {
      expect(findings).toHaveLength(1);
      const data = findings[0].data as {
        route: string;
        grew: string[];
        history: GraphSize[];
        survived: GraphSize[];
      };
      expect(data.route).toBe(route);
      expect(data.grew).toContain("owners");
      expect(data.survived).toHaveLength(3);
      // What outlived each navigation climbs by the leaked root (its owner and
      // its render effect) per visit; the totals include the page too.
      expect(data.survived.map(s => s.owners - data.survived[0].owners)).toEqual([0, 2, 4]);
      for (let i = 0; i < 3; i++)
        expect(data.survived[i].owners).toBeLessThanOrEqual(data.history[i].owners);
      const series = (of: GraphSize[]) => of.map(s => s.owners).join(" → ");
      expect(findings[0].message).toContain(
        `owners ${series(data.survived)} (of ${series(data.history)})`
      );
    } finally {
      cleanup();
    }
    expect(graphSize()).toEqual(before);
  });

  it("a signal kept per visit and read by a long-lived computation reports signals and edges", () => {
    const before = graphSize();
    const { findings } = arm();
    const [location, setLocation] = createSignal("/");
    // The mistake: a module-level list each visit appends a signal to, read by
    // a computation that lives as long as the app.
    const kept: Accessor<number>[] = [];
    const dispose = createRoot(dispose => {
      const page = createMemo(() => {
        const route = location();
        if (route === "/orders") {
          const [selection] = createSignal(0);
          kept.push(selection);
        }
        return route;
      });
      createRenderEffect(
        () => (page(), kept.reduce((sum, s) => sum + s(), 0)),
        () => {}
      );
      return dispose;
    });
    flush();
    try {
      for (let i = 0; i < 3; i++) {
        navigate(setLocation, "/orders");
        navigate(setLocation, "/home");
      }
      expect(findings).toHaveLength(1);
      const data = findings[0].data as { route: string; grew: string[]; survived: GraphSize[] };
      expect(data.route).toBe("/orders");
      expect(data.grew).toEqual(["signals", "edges"]);
      expect(data.survived.map(s => s.signals - data.survived[0].signals)).toEqual([0, 1, 2]);
      expect(data.survived.map(s => s.edges - data.survived[0].edges)).toEqual([0, 1, 2]);
    } finally {
      dispose();
      flush();
    }
    expect(graphSize()).toEqual(before);
  });

  it("components shared with the page just left, through HMR plumbing, do not report (#4101)", () => {
    const before = graphSize();
    const { findings, graphs } = arm();
    const [location, setLocation] = createSignal("/");
    // solid-refresh's registry: a signal per component, as long-lived as its
    // module, read by a plumbing memo in each rendered instance.
    const registry = ["Title", "Card", "Button"].map(
      name => createSignal({ current: name }, { name })[0]
    );
    const instance = (i: number) =>
      createMemo(() => registry[i]().current, { _plumbing: true } as never);
    let visit = 0;
    const pages: Record<string, () => unknown> = {
      // Each page the target is reached from renders more of its components.
      "/from-0": () => [],
      "/from-1": () => [instance(0)],
      "/from-2": () => [instance(0), instance(1)],
      // The target renders the same components each visit, and content that
      // differs per visit: a row more each time, owned by the page.
      "/target": () => {
        visit++;
        const rows = Array.from({ length: visit }, (_, i) => createSignal(i)[0]);
        return [instance(0), instance(1), instance(2), createMemo(() => rows.map(row => row()))];
      }
    };
    const dispose = createRoot(dispose => {
      const page = createMemo(() => {
        const mount = pages[location()];
        return mount ? untrack(mount) : [];
      });
      createRenderEffect(
        () => (page() as (() => unknown)[]).map(read => read()),
        () => {}
      );
      return dispose;
    });
    flush();
    try {
      for (const from of ["/from-0", "/from-1", "/from-2"]) {
        navigate(setLocation, from);
        navigate(setLocation, "/target");
      }
      // The page is bigger each visit, and the registry signals of the
      // components the previous page shared were alive before each arrival.
      const totals = graphs.filter(g => g.route === "/target").map(g => g.signals);
      expect(totals[1]).toBeGreaterThan(totals[0]);
      expect(totals[2]).toBeGreaterThan(totals[1]);
      expect(findings).toHaveLength(0);
    } finally {
      dispose();
      flush();
    }
    expect(graphSize()).toEqual(before);
  });

  it("a long-lived source the page just left also read is not what a visit left behind", () => {
    const before = graphSize();
    const { findings, graphs } = arm();
    const [location, setLocation] = createSignal("/");
    // Module-level state, alive the whole session: the walk reaches each
    // only through a page that reads it.
    const globals = Array.from({ length: 6 }, (_, i) => createSignal(i, { name: `g${i}` })[0]);
    let visit = 0;
    const pages: Record<string, () => unknown> = {
      // Each page between visits reads more of what the target reads.
      "/a-1": () => globals.slice(0, 1).map(g => createMemo(g)),
      "/a-2": () => globals.slice(0, 3).map(g => createMemo(g)),
      "/a-3": () => globals.slice(0, 5).map(g => createMemo(g)),
      "/target": () => {
        visit++;
        // Content that differs per visit, owned by the page.
        const rows = Array.from({ length: visit * 2 }, (_, i) => createSignal(i)[0]);
        return [...globals.map(g => createMemo(g)), createMemo(() => rows.map(row => row()))];
      }
    };
    const dispose = createRoot(dispose => {
      const page = createMemo(() => {
        const mount = pages[location()];
        return mount ? untrack(mount) : [];
      });
      createRenderEffect(
        () => (page() as (() => unknown)[]).map(read => read()),
        () => {}
      );
      return dispose;
    });
    flush();
    try {
      for (const from of ["/a-1", "/a-2", "/a-3"]) {
        navigate(setLocation, from);
        navigate(setLocation, "/target");
      }
      const totals = graphs.filter(g => g.route === "/target").map(g => g.signals);
      expect(totals[2]).toBeGreaterThan(totals[1]);
      expect(totals[1]).toBeGreaterThan(totals[0]);
      expect(findings).toHaveLength(0);
    } finally {
      dispose();
      flush();
    }
    expect(graphSize()).toEqual(before);
  });

  it("a page kept across navigations within its route, growing a row per query, does not report", () => {
    const before = graphSize();
    const { findings, graphs } = arm();
    const [location, setLocation] = createSignal({ route: "/", q: "" });
    const [shared] = createSignal(1);
    const dispose = createRoot(dispose => {
      const route = createMemo(() => location().route);
      const query = createMemo(() => location().q);
      // Keyed on the route pattern: a query change keeps the page.
      const page = createMemo(() => {
        if (route() !== "/search") return () => 0;
        const owner = getOwner() as Owner;
        const rows: Accessor<number>[] = [];
        // Each query asked adds a row the page owns until it leaves.
        createRenderEffect(
          () => {
            query();
            untrack(() => runWithOwner(owner, () => rows.push(createMemo(shared))));
          },
          () => {}
        );
        return () => rows.reduce((sum, row) => sum + row(), 0);
      });
      createRenderEffect(
        () => page()(),
        () => {}
      );
      return dispose;
    });
    flush();
    const go = (route: string, q = "") => {
      OBSERVE!.attribution.withOrigin(
        { kind: "navigation", name: route, to: q ? `${route}?q=${q}` : route },
        () => setLocation({ route, q })
      );
      flush();
    };
    try {
      go("/home");
      for (const q of ["a", "b", "c", "d"]) go("/search", q);
      const totals = graphs.filter(g => g.route === "/search").map(g => g.owners);
      // The page grows on every query: the totals alone read that as a leak.
      expect(totals).toHaveLength(4);
      for (let i = 1; i < totals.length; i++) expect(totals[i]).toBeGreaterThan(totals[i - 1]);
      // Navigations within the route continue the visit: the page they kept
      // outlived each of them by design, so they are not compared.
      expect(findings).toHaveLength(0);
      // Leaving disposes the page with every row it kept; coming back starts over.
      go("/home");
      go("/search", "e");
      expect(graphs[graphs.length - 1].owners).toBe(totals[0]);
      expect(findings).toHaveLength(0);
    } finally {
      dispose();
      flush();
    }
    expect(graphSize()).toEqual(before);
  });
});
