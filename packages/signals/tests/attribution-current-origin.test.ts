/**
 * `OBSERVE.attribution.currentOrigin()` — the engine's one query.
 *
 * Claim under test: a runtime recording a fact of its own (the web runtime's
 * `"call"` record, a server-function call) can ask, at the moment it makes
 * it, what a root write there would be stamped with — and gets the engine's
 * OWN frame object: the interaction whose handler is running, the navigation
 * whose write is in progress, the origin of the change a recompute is
 * answering — so the fact joins `InteractionEvent.origin` /
 * `NavigationEvent.origin` by identity, not by time. `undefined` where a
 * write would stamp `external`, and with no engine installed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { attribution } from "../src/attribution.js";
import {
  createEffect,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  OBSERVE
} from "../src/index.js";
import type { ChangeOrigin, InteractionEvent, NavigationEvent } from "../src/core/attribution.js";
import type { NavigationRef } from "../src/core/attribution-hooks.js";
import type { RecordListener, RecordType } from "../src/core/dev.js";

const INSTALLED = Symbol.for("@solidjs/signals/observe/attribution");
const current = () => OBSERVE!.attribution.currentOrigin();

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

function arm() {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  attribution.enable({ log: false, hotRuns: false, hotTime: false, waterfalls: false });
  const interactions: InteractionEvent[] = [];
  const navigations: NavigationEvent[] = [];
  on("interaction", e => interactions.push(e));
  on("navigation", e => navigations.push(e));
  return { interactions, navigations };
}

const CLICK = { type: "click", target: 'a.nav "Alice"' };
const NAV: NavigationRef = {
  kind: "navigation",
  name: "/users/:id",
  to: "/users/42",
  from: "/users"
};

describe("currentOrigin", () => {
  it("is undefined with no engine installed, and outside any frame with one", () => {
    expect(OBSERVE!.attribution.installed).toBeNull();
    expect(current()).toBeUndefined();
    arm();
    expect(current()).toBeUndefined();
  });

  it("registers the installed engine on globalThis for a reach without an import, and clears it", () => {
    expect((globalThis as any)[INSTALLED]).toBeUndefined();
    arm();
    const hooks = (globalThis as any)[INSTALLED];
    expect(hooks).toBe(OBSERVE!.attribution.installed);
    expect(typeof hooks.currentOrigin).toBe("function");
    attribution.disable();
    expect((globalThis as any)[INSTALLED]).toBeUndefined();
  });

  it("inside a handler: the interaction — the same object the interaction record carries", () => {
    const { interactions } = arm();
    let seen: ChangeOrigin | undefined;
    OBSERVE!.attribution.withInteraction(CLICK, () => {
      seen = current();
    });
    flush();
    expect(seen).toMatchObject({ kind: "interaction", name: "click", target: CLICK.target });
    expect(interactions).toHaveLength(1);
    expect(interactions[0].origin).toBe(seen);
    // Closed with the frame.
    expect(current()).toBeUndefined();
  });

  it("inside a navigation's write: the navigation frame, under its click — the navigation record's origin", () => {
    const { navigations } = arm();
    const [location, setLocation] = createSignal("/users", { name: "location" });
    createRoot(() => createEffect(location, () => {}, { name: "reader" }));
    flush();
    let seen: ChangeOrigin | undefined;
    OBSERVE!.attribution.withInteraction(CLICK, () =>
      OBSERVE!.attribution.withOrigin(NAV, () => {
        seen = current();
        setLocation("/users/42");
      })
    );
    flush();
    expect(seen).toMatchObject({
      kind: "navigation",
      name: "/users/:id",
      to: "/users/42",
      interaction: { kind: "interaction", name: "click" }
    });
    expect(navigations).toHaveLength(1);
    expect(navigations[0].origin).toBe(seen);
  });

  it("inside a recompute: the origin of the change that caused the run — a page's fetch on a navigation is the navigation's", () => {
    const { navigations } = arm();
    const [location, setLocation] = createSignal("/users", { name: "location" });
    const probed: (ChangeOrigin | undefined)[] = [];
    const page = createMemo(
      () => {
        const l = location();
        // What a `createAsync(() => serverFn(l))` does: the call is made
        // inside the compute, and the record is stamped there.
        probed.push(current());
        return l;
      },
      { name: "page" }
    );
    createRoot(() => createRenderEffect(page, () => {}, { name: "view" }));
    flush();
    // The mount run: no cause, nothing ambient.
    expect(probed).toEqual([undefined]);

    OBSERVE!.attribution.withInteraction(CLICK, () =>
      OBSERVE!.attribution.withOrigin(NAV, () => setLocation("/users/42"))
    );
    flush();
    expect(probed).toHaveLength(2);
    expect(probed[1]).toMatchObject({ kind: "navigation", name: "/users/:id" });
    expect(probed[1]).toBe(navigations[0].origin);
    expect(probed[1]!.interaction).toBe(navigations[0].interaction);
  });

  it("inside a recompute caused by a derived change: walks the derived link to the root write's origin", () => {
    const { interactions } = arm();
    const [n, setN] = createSignal(1, { name: "n" });
    const doubled = createMemo(() => n() * 2, { name: "doubled" });
    let seen: ChangeOrigin | undefined;
    const view = createMemo(
      () => {
        const d = doubled();
        seen = current();
        return d;
      },
      { name: "view" }
    );
    createRoot(() => createRenderEffect(view, () => {}, { name: "render" }));
    flush();
    OBSERVE!.attribution.withInteraction(CLICK, () => setN(2));
    flush();
    expect(seen).toMatchObject({ kind: "interaction", name: "click" });
    expect(seen).toBe(interactions[0].origin);
  });

  it("a recompute whose causes are external, pulled inside a handler: the ambient interaction", () => {
    const { interactions } = arm();
    const [n, setN] = createSignal(1, { name: "n" });
    let seen: ChangeOrigin | undefined;
    const stale = createMemo(
      () => {
        const v = n();
        seen = current();
        return v;
      },
      { name: "stale" }
    );
    createRoot(() => createRenderEffect(stale, () => {}, { name: "render" }));
    flush();
    // A timer's write: external, still pending when the click arrives.
    setN(2);
    OBSERVE!.attribution.withInteraction(CLICK, () => {
      // The handler drains: the recompute's cause is the external write,
      // which names nothing — the click that ran it is what the call is for.
      flush();
      expect(stale()).toBe(2);
    });
    flush();
    expect(seen).toMatchObject({ kind: "interaction", name: "click" });
    expect(seen).toBe(interactions[0].origin);
  });

  it("a node created inside a handler: the ambient interaction (a create run has no cause of its own)", () => {
    const { interactions } = arm();
    let seen: ChangeOrigin | undefined;
    OBSERVE!.attribution.withInteraction(CLICK, () => {
      createRoot(() => {
        const m = createMemo(
          () => {
            seen = current();
            return 1;
          },
          { name: "fresh" }
        );
        m();
      });
    });
    flush();
    expect(seen).toMatchObject({ kind: "interaction", name: "click" });
    expect(seen).toBe(interactions[0].origin);
  });

  it("inside an effect callback: the effect frame, under the interaction whose write caused the run", () => {
    const { interactions } = arm();
    const [n, setN] = createSignal(0, { name: "n" });
    const seen: (ChangeOrigin | undefined)[] = [];
    createRoot(() =>
      createEffect(
        n,
        () => {
          seen.push(current());
        },
        { name: "sync" }
      )
    );
    flush();
    OBSERVE!.attribution.withInteraction(CLICK, () => setN(1));
    flush();
    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({ kind: "effect", name: "sync" });
    expect(seen[0]!.interaction).toBeUndefined();
    expect(seen[1]).toMatchObject({ kind: "effect", name: "sync" });
    expect(seen[1]!.interaction).toBe(interactions[0].origin);
  });
});
