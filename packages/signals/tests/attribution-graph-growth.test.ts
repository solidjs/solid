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
import type { GraphEvent, NavigationEvent } from "../src/attribution.js";
import {
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  flush,
  OBSERVE,
  runWithOwner
} from "../src/index.js";
import type { DiagnosticEvent } from "../src/core/dev.js";

afterEach(() => {
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
  attribution.subscribe("graph", e => graphs.push(e));
  const navigations: NavigationEvent[] = [];
  attribution.subscribe("navigation", e => navigations.push(e));
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
    createEffect(
      page,
      route => {
        if (route !== "/orders" || leak === false) return;
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
          runWithOwner(null, () => {
            createEffect(shared, () => {});
          });
        }
      },
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
});
