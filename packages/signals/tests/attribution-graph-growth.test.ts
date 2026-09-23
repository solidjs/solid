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
  OBSERVE
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

/** An app root with a location and a synchronous page; `leak` mounts a root per visit that nobody disposes. */
function app(leak: boolean) {
  const [location, setLocation] = createSignal("/", { name: "location" });
  const leaked: (() => void)[] = [];
  const dispose = createRoot(dispose => {
    const page = createMemo(() => location(), { name: "page" });
    createEffect(
      page,
      route => {
        if (leak && route === "/orders") {
          // The mistake: a detached root per visit, never disposed.
          createRoot(d => {
            leaked.push(d);
            const [n] = createSignal(0);
            createEffect(n, () => {});
            createMemo(() => n() + 1);
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
  it("counts the owners reachable from the live top-level roots, and the roots", () => {
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
    dispose();
    const after = graphSize();
    expect(after.roots).toBe(before.roots);
    expect(after.owners).toBe(before.owners);
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
    const { setLocation, dispose, leaked } = app(true);
    for (let i = 0; i < 3; i++) {
      navigate(setLocation, "/orders");
      navigate(setLocation, "/", "/");
    }
    expect(leaked).toHaveLength(3);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ code: "GRAPH_GROWTH", kind: "perf", severity: "warn" });
    const data = findings[0].data as {
      route: string;
      owners: number[];
      roots: number;
      routes: string[];
    };
    // The count is the graph's: the first route to complete its climb reports, naming the others.
    expect(data.route).toBe("/orders");
    expect(data.routes).toEqual(["/orders", "/"]);
    expect(data.owners).toHaveLength(3);
    expect(data.owners[1]).toBeGreaterThan(data.owners[0]);
    expect(data.owners[2]).toBeGreaterThan(data.owners[1]);
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
    const { setLocation, dispose, leaked } = app(true);
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
