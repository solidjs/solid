import { flush } from "@solidjs/signals";
import { assertBudget, expectNoDiagnostics } from "../src/index.js";
import { installDiagnosticsBridge, BRIDGE_GLOBAL } from "../src/browser.js";
import { captureBrowserArtifact } from "../src/playwright.js";
import type { EvaluatingPage } from "../src/playwright.js";
import { mountTodoApp } from "./fixtures/todo-app.js";
import { deterministicAttribution } from "./helpers.js";

/**
 * In-process stand-in for a Playwright page. Runs evaluate callbacks in the
 * same realm (where the bridge global lives) but forces both arguments and
 * return values through JSON — the same constraint a real page boundary
 * imposes — so any non-serializable leak fails here, not in CI-with-browser.
 */
function fakePage(realm: Record<string, unknown>): EvaluatingPage {
  const roundTrip = <V>(value: V): V =>
    value === undefined ? value : JSON.parse(JSON.stringify(value));
  return {
    async evaluate(pageFunction: (arg?: unknown) => unknown, arg?: unknown) {
      const previous = (globalThis as Record<string, unknown>)[BRIDGE_GLOBAL];
      (globalThis as Record<string, unknown>)[BRIDGE_GLOBAL] = realm[BRIDGE_GLOBAL];
      try {
        return roundTrip(await pageFunction(roundTrip(arg)));
      } finally {
        (globalThis as Record<string, unknown>)[BRIDGE_GLOBAL] = previous;
      }
    }
  } as EvaluatingPage;
}

describe("browser bridge + playwright adapter", () => {
  it("captures a scripted interaction across the page boundary", async () => {
    const realm: Record<string, unknown> = {};
    installDiagnosticsBridge(realm);
    const page = fakePage(realm);

    // The "app" lives in the page realm; the driver only sees the handle.
    const app = mountTodoApp();
    flush();

    const { artifact } = await captureBrowserArtifact(
      page,
      async () => {
        app.addTodo("write tests");
        flush();
        app.addTodo("ship it", true);
        flush();
        app.setFilter("active");
        flush();
      },
      { scenario: "browser-toggle", attribution: deterministicAttribution }
    );
    app.dispose();

    expect(artifact.formatVersion).toBe(1);
    expect(artifact.scenario).toBe("browser-toggle");
    expectNoDiagnostics(artifact);
    // Same assertions work on browser-captured artifacts: mount happened
    // before the capture, so only the interaction's re-runs are counted.
    assertBudget(artifact, {
      maxWastedRuns: 0,
      scopes: { visibleCount: 3, renderHeader: 3, themeWatcher: 0 }
    });
    // The payload crossed a JSON boundary — spot-check attribution survived.
    expect(artifact.attribution!.reruns.length).toBeGreaterThan(0);
    expect(artifact.attribution!.costs.scopes.length).toBeGreaterThan(0);
  });

  it("fails clearly when the bridge is not installed", async () => {
    const page = fakePage({});
    await expect(captureBrowserArtifact(page, async () => {})).rejects.toThrow(/bridge not found/);
  });

  it("guards against overlapping sessions and tears down on interaction failure", async () => {
    const realm: Record<string, unknown> = {};
    const bridge = installDiagnosticsBridge(realm);
    const page = fakePage(realm);

    await expect(
      captureBrowserArtifact(page, async () => {
        throw new Error("interaction failed");
      })
    ).rejects.toThrow("interaction failed");
    // Session was torn down, so a fresh capture works.
    expect(bridge.active()).toBe(false);
    const { artifact } = await captureBrowserArtifact(page, async () => {});
    expect(artifact.diagnostics).toEqual([]);
  });

  it("answers whyDidRun and costs queries against the open session", async () => {
    const realm: Record<string, unknown> = {};
    const bridge = installDiagnosticsBridge(realm);

    expect(() => bridge.whyDidRun("visibleCount")).toThrow(/requires an open session/);

    const app = mountTodoApp();
    flush();
    bridge.begin();
    app.addTodo("write tests");
    flush();

    const reruns = bridge.whyDidRun("visibleCount");
    expect(reruns.length).toBe(1);
    expect(reruns[0]!.nodeName).toBe("visibleCount");
    expect(JSON.parse(JSON.stringify(reruns))).toEqual(reruns);

    const costs = bridge.costs();
    expect(costs.scopes.map(scope => scope.name)).toContain("visibleCount");

    bridge.end();
    app.dispose();
  });

  it("supports diagnostics-only captures", async () => {
    const realm: Record<string, unknown> = {};
    installDiagnosticsBridge(realm);
    const page = fakePage(realm);
    const { artifact } = await captureBrowserArtifact(page, async () => {}, {
      attribution: false
    });
    expect(artifact.attribution).toBeNull();
  });
});
