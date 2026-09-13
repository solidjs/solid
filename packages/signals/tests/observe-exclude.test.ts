/**
 * `OBSERVE.exclude(owner)` — the observer's own subtree.
 *
 * Claim under test: an APM adapter or devtools panel that renders inside the
 * app it watches marks its root, and neither channel reports it afterwards —
 * diagnostics whose subject sits under the owner are built but never
 * delivered or printed, and the attribution engine records no run for its
 * computations — while the app around it is reported exactly as before.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { attribution } from "../src/attribution.js";
import {
  createEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  getOwner,
  runWithOwner,
  DEV,
  OBSERVE
} from "../src/index.js";
import type { DiagnosticEvent } from "../src/core/dev.js";
import type { Owner } from "../src/core/types.js";

afterEach(() => {
  attribution.disable();
  flush();
  vi.restoreAllMocks();
});

function arm() {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  attribution.enable({ log: false });
  const seen: DiagnosticEvent[] = [];
  OBSERVE!.diagnostics.subscribe(e => seen.push(e));
  return seen;
}

/** A panel root, excluded as it is created, that returns its owner. */
function excludedRoot<T>(body: () => T): { owner: Owner; result: T } {
  return createRoot(() => {
    const owner = getOwner()!;
    OBSERVE!.exclude(owner);
    return { owner, result: body() };
  });
}

describe("OBSERVE.exclude", () => {
  it("marks the subtree, not the app around it", () => {
    const { owner } = excludedRoot(() => {});
    expect(OBSERVE!.isExcluded(owner)).toBe(true);
    let inside!: Owner;
    runWithOwner(owner, () => createRoot(() => (inside = getOwner()!)));
    expect(OBSERVE!.isExcluded(inside)).toBe(true);
    createRoot(() => expect(OBSERVE!.isExcluded(getOwner())).toBe(false));
    expect(OBSERVE!.isExcluded(null)).toBe(false);
  });

  it("drops diagnostics about the excluded subtree from the channel and the console", () => {
    const seen = arm();
    const { owner } = excludedRoot(() => {});
    const entry = OBSERVE!.diagnostics.emit(
      { code: "HUGE_FAN_OUT", kind: "graph", severity: "warn", message: "[HUGE_FAN_OUT] panel" },
      owner
    );
    // Built (a throwing site still has its message), never delivered.
    expect(entry.message).toBe("[HUGE_FAN_OUT] panel");
    expect(entry.ownerPath).toBeUndefined();
    expect(seen).toHaveLength(0);
    DEV!.report(entry);
    expect(console.warn).not.toHaveBeenCalled();
    // The same event about the app is delivered and printed.
    createRoot(() => {
      const app = OBSERVE!.diagnostics.emit(
        { code: "HUGE_FAN_OUT", kind: "graph", severity: "warn", message: "[HUGE_FAN_OUT] app" },
        getOwner()
      );
      DEV!.report(app);
    });
    expect(seen.map(e => e.message)).toEqual(["[HUGE_FAN_OUT] app"]);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("silences an engine finding about the panel's own store when the write runs under its owner", () => {
    const seen = arm();
    const { owner, result: setEvents } = excludedRoot(() => {
      const [, setEvents] = createStore<{ list: { id: number }[] }>({
        list: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]
      });
      return setEvents;
    });
    // The spread-copy habit the census flags — performed as an adapter would,
    // from outside the graph but under its own owner.
    runWithOwner(owner, () =>
      setEvents(s => {
        s.list = [{ id: 0 }, ...s.list];
      })
    );
    flush();
    expect(seen.filter(e => e.code === "IMMUTABLE_UPDATE_IN_STORE")).toHaveLength(0);
    // The same write from the app is reported.
    const [, setApp] = createStore<{ list: { id: number }[] }>({
      list: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]
    });
    setApp(s => {
      s.list = [{ id: 0 }, ...s.list];
    });
    flush();
    expect(seen.filter(e => e.code === "IMMUTABLE_UPDATE_IN_STORE")).toHaveLength(1);
  });

  it("forgets an interaction whose only writes went to the panel's own store", () => {
    arm();
    const delivered: unknown[] = [];
    attribution.subscribe("interaction", e => delivered.push(e));
    const { owner, result: setPanel } = excludedRoot(() => {
      const [panel, setPanel] = createStore<{ items: number[] }>({ items: [] });
      // The panel renders its list, so the store has live nodes to write.
      createEffect(
        () => panel.items.length,
        () => {},
        { name: "panelList" }
      );
      return setPanel;
    });
    flush();
    // The panel's own "clear" button: a real DOM click the runtime stamps,
    // whose handler writes nothing but the panel's store.
    OBSERVE!.attribution.withInteraction({ type: "click", target: "button" }, () =>
      runWithOwner(owner, () => setPanel(s => void s.items.push(1)))
    );
    flush();
    expect(attribution.interactions()).toHaveLength(0);
    expect(delivered).toHaveLength(0);

    // A click that also writes the app is the app's: recorded, with the
    // panel write not counted among its writes.
    const [, setApp] = createSignal(0, { name: "app" });
    OBSERVE!.attribution.withInteraction({ type: "click" }, () => {
      runWithOwner(owner, () => setPanel(s => void s.items.push(2)));
      setApp(1);
    });
    flush();
    expect(attribution.interactions()).toHaveLength(1);
    expect(delivered).toHaveLength(1);
    expect(attribution.interactions()[0].writes).toBe(1);
  });

  it("records no runs for the panel's computations", () => {
    arm();
    const [tick, setTick] = createSignal(0, { name: "tick" });
    excludedRoot(() => createEffect(tick, () => {}, { name: "panel" }));
    createRoot(() => createEffect(tick, () => {}, { name: "app" }));
    flush();
    OBSERVE!.attribution.withInteraction({ type: "click" }, () => setTick(1));
    flush();
    const names = attribution.history().map(r => r.nodeName);
    expect(names).toEqual(["app"]);
    expect(attribution.costs().scopes.map(s => s.name)).toEqual(["app"]);
    const [click] = attribution.interactions();
    expect(click.runs).toBe(1);
  });
});
