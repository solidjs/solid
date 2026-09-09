/**
 * Navigations as a declared origin.
 *
 * Claim under test: a router that wraps its location write in
 * `OBSERVE.attribution.withOrigin({ kind: "navigation", … })` gets every
 * downstream fact named by route — the writes' origin, the re-runs' cause
 * chains, the hold the writes wait in and its verdicts — and one
 * `NavigationEvent` per navigation that settles exactly once: `committed`
 * when a plain drain took the writes, `held` when they waited in a
 * transition (the HoldEvent attached), `superseded` when a later write
 * replaced them before they landed. Nothing in the engine knows a router;
 * the frame is the whole contract.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { attribution } from "../src/attribution.js";
import {
  action,
  createEffect,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  OBSERVE
} from "../src/index.js";
import type { NavigationRef } from "../src/index.js";
import type { RerunEvent } from "../src/core/attribution.js";
import type { DiagnosticEvent } from "../src/core/dev.js";

afterEach(() => {
  attribution.disable();
  flush();
  vi.restoreAllMocks();
});

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until(cond: () => boolean, what: string, timeout = 5000) {
  const start = Date.now();
  for (;;) {
    flush();
    if (cond()) return;
    if (Date.now() - start > timeout) throw new Error(`timed out waiting for ${what}`);
    await wait(5);
  }
}

function arm(opts: { holds?: false } = {}) {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  attribution.enable({
    log: false,
    hotRuns: false,
    hotTime: false,
    waterfalls: false,
    holds: opts.holds ?? { infoMs: 0, warnMs: 0 }
  });
  const runs: RerunEvent[] = [];
  attribution.subscribe(e => runs.push(e));
  const silent: DiagnosticEvent[] = [];
  OBSERVE!.diagnostics.subscribe(e => {
    if (e.code === "SILENT_HOLD") silent.push(e);
  });
  return { runs, silent };
}

const CLICK = { type: "click", target: 'a.nav "Alice"' };
const NAV: NavigationRef = {
  kind: "navigation",
  name: "/users/:id",
  to: "/users/42",
  from: "/users",
  params: { id: "42" }
};

/** A location signal and an async page that re-fetches whenever it changes. */
function routedApp() {
  const [location, setLocation] = createSignal("/users", { name: "location" });
  let resolve: ((v: string) => void) | null = null;
  const page = createMemo(
    () => {
      const l = location();
      return new Promise<string>(r => (resolve = v => r(`${v}@${l}`)));
    },
    { name: "page" }
  );
  const shown: string[] = [];
  createRoot(() =>
    createRenderEffect(
      page,
      v => {
        shown.push(v);
      },
      { name: "view" }
    )
  );
  return { location, setLocation, shown, resolve: (v: string) => resolve!(v) };
}

describe("withOrigin — navigation provenance", () => {
  it("stamps the writes inside the frame as the navigation, under the enclosing interaction", () => {
    const { runs } = arm();
    const [location, setLocation] = createSignal("/users", { name: "location" });
    createRoot(() => createEffect(location, () => {}, { name: "reader" }));
    flush();
    const before = performance.now();
    OBSERVE!.attribution.withInteraction(CLICK, () =>
      OBSERVE!.attribution.withOrigin(NAV, () => setLocation("/users/42"))
    );
    flush();
    const run = runs.filter(r => r.nodeName === "reader").at(-1)!;
    const origin = run.causes[0].origin!;
    expect(origin).toMatchObject({
      kind: "navigation",
      name: "/users/:id",
      to: "/users/42",
      from: "/users",
      params: { id: "42" },
      interaction: { kind: "interaction", name: "click", target: CLICK.target }
    });
    expect(origin.at).toBeGreaterThanOrEqual(before);
    // Downstream facts still key by the interaction that paid for it.
    expect(run.interaction).toBe(origin.interaction);
    const text = attribution.format(run);
    expect(text).toContain(`— navigation to /users/:id (/users/42) (under click on a.nav "Alice")`);
  });

  it("stands alone when nothing user-dispatched encloses it (a redirect)", () => {
    const { runs } = arm();
    const [location, setLocation] = createSignal("/users", { name: "location" });
    createRoot(() => createEffect(location, () => {}, { name: "reader" }));
    flush();
    OBSERVE!.attribution.withOrigin({ kind: "navigation", name: "/login", to: "/login" }, () =>
      setLocation("/login")
    );
    flush();
    const run = runs.filter(r => r.nodeName === "reader").at(-1)!;
    expect(run.causes[0].origin).toEqual(
      expect.objectContaining({ kind: "navigation", name: "/login" })
    );
    expect(run.causes[0].origin!.interaction).toBeUndefined();
    expect(run.interaction).toBeUndefined();
    // Pattern equal to the concrete path: no redundant parenthetical.
    expect(attribution.formatOrigin(run.causes[0].origin!)).toBe("navigation to /login");
  });

  it("inherits the interaction of an action step it runs in, after the click is long gone", async () => {
    const { runs } = arm();
    const [location, setLocation] = createSignal("/todos", { name: "location" });
    createRoot(() => createEffect(location, () => {}, { name: "reader" }));
    flush();
    const save = action(async function* save() {
      yield wait(5);
      OBSERVE!.attribution.withOrigin(
        { kind: "navigation", name: "/todos/:id", to: "/todos/7", params: { id: "7" } },
        () => setLocation("/todos/7")
      );
    });
    const done = OBSERVE!.attribution.withInteraction(CLICK, () => save());
    await done;
    await until(() => runs.some(r => r.nodeName === "reader"), "the reader's re-run");
    const run = runs.filter(r => r.nodeName === "reader").at(-1)!;
    expect(run.causes[0].origin).toMatchObject({
      kind: "navigation",
      name: "/todos/:id",
      interaction: { kind: "interaction", name: "click" }
    });
    expect(attribution.navigations().at(-1)!.interaction).toMatchObject({ name: "click" });
  });

  it("is a plain call when no engine is installed", () => {
    // Not armed: attribution is disabled, so the core's slot has no hooks.
    expect(OBSERVE!.attribution.installed).toBeNull();
    const [location, setLocation] = createSignal("/a", { name: "location" });
    const result = OBSERVE!.attribution.withOrigin(NAV, () => {
      setLocation("/b");
      return 42;
    });
    expect(result).toBe(42);
    flush();
    expect(location()).toBe("/b");
    expect(attribution.navigations()).toEqual([]);
  });
});

describe("navigations() — one settled record per frame", () => {
  it("settles a navigation no transition held as committed at the end of the drain", () => {
    arm();
    const [location, setLocation] = createSignal("/users", { name: "location" });
    createRoot(() => createEffect(location, () => {}, { name: "reader" }));
    flush();
    OBSERVE!.attribution.withInteraction(CLICK, () =>
      OBSERVE!.attribution.withOrigin(NAV, () => setLocation("/users/42"))
    );
    const [open] = attribution.navigations();
    expect(open).toMatchObject({
      name: "/users/:id",
      to: "/users/42",
      from: "/users",
      params: { id: "42" },
      writes: 1,
      interaction: { name: "click" }
    });
    expect(open.settledMs).toBeUndefined();
    expect(open.outcome).toBeUndefined();
    flush();
    expect(open.outcome).toBe("committed");
    expect(open.settledMs).toBeGreaterThanOrEqual(0);
    expect(open.hold).toBeUndefined();
    expect(attribution.navigations()).toHaveLength(1);
  });

  it("settles immediately when no write survived the equality gate", () => {
    arm();
    const [, setLocation] = createSignal("/users", { name: "location" });
    OBSERVE!.attribution.withOrigin({ kind: "navigation", name: "/users", to: "/users" }, () =>
      setLocation("/users")
    );
    const [nav] = attribution.navigations();
    expect(nav.writes).toBe(0);
    expect(nav.outcome).toBe("committed");
  });

  it("settles at frame close when a drain inside the frame already committed the writes", () => {
    arm();
    const [location, setLocation] = createSignal("/a", { name: "location" });
    createRoot(() => createEffect(location, () => {}, { name: "reader" }));
    flush();
    OBSERVE!.attribution.withOrigin({ kind: "navigation", name: "/b", to: "/b" }, () =>
      flush(() => setLocation("/b"))
    );
    const [nav] = attribution.navigations();
    expect(nav.writes).toBe(1);
    expect(nav.outcome).toBe("committed");
  });

  it("settles a navigation performed inside an effect (a redirect during a drain)", () => {
    arm();
    const [location, setLocation] = createSignal("/private", { name: "location" });
    const [authed, setAuthed] = createSignal(true, { name: "authed" });
    createRoot(() => {
      createEffect(
        authed,
        ok => {
          if (!ok)
            OBSERVE!.attribution.withOrigin(
              { kind: "navigation", name: "/login", to: "/login", from: "/private" },
              () => setLocation("/login")
            );
        },
        { name: "guard" }
      );
      createEffect(location, () => {}, { name: "reader" });
    });
    flush();
    setAuthed(false);
    flush();
    expect(location()).toBe("/login");
    const [nav] = attribution.navigations();
    expect(nav).toMatchObject({ name: "/login", writes: 1, outcome: "committed" });
    expect(nav.origin.interaction).toBeUndefined();
  });

  it("settles a held navigation with the hold attached, and names the hold by route", async () => {
    const { silent } = arm();
    const app = routedApp();
    flush();
    app.resolve("alice");
    await until(() => app.shown.includes("alice@/users"), "initial load");

    OBSERVE!.attribution.withInteraction({ ...CLICK, at: performance.now() }, () =>
      OBSERVE!.attribution.withOrigin(NAV, () => app.setLocation("/users/42"))
    );
    flush();
    expect(app.shown).toEqual(["alice@/users"]); // held: nothing painted
    const [nav] = attribution.navigations();
    expect(nav.outcome).toBeUndefined(); // still waiting on the page
    await wait(10);
    app.resolve("alice");
    await until(() => app.shown.includes("alice@/users/42"), "the held page to land");

    expect(nav.outcome).toBe("held");
    expect(nav.hold).toBeDefined();
    expect(nav.settledMs).toBeGreaterThanOrEqual(10);
    const [hold] = attribution.holds();
    expect(nav.hold).toBe(hold);
    // The hold names the navigation, and joins to it by identity.
    expect(hold.origin).toBe(nav.origin);
    expect(hold.origin).toMatchObject({ kind: "navigation", name: "/users/:id" });
    expect(hold.interaction).toMatchObject({ kind: "interaction", name: "click" });
    expect(hold.heldWrites.map(w => w.name)).toEqual(["location"]);
    expect(hold.blockers).toEqual(["page"]);
    // The verdict reads from what the user did, through the route.
    expect(silent).toHaveLength(1);
    expect(silent[0].message).toContain(
      `[SILENT_HOLD] click on a.nav "Alice" (navigation to /users/:id (/users/42)) wrote "location"`
    );
    expect(silent[0].data).toMatchObject({
      navigation: { name: "/users/:id", to: "/users/42", from: "/users", params: { id: "42" } }
    });
  });

  it("names a redirect's hold by the navigation alone when no interaction is known", async () => {
    const { silent } = arm();
    const app = routedApp();
    flush();
    app.resolve("a");
    await until(() => app.shown.includes("a@/users"), "initial load");

    OBSERVE!.attribution.withOrigin(NAV, () => app.setLocation("/users/42"));
    flush();
    await wait(10);
    app.resolve("b");
    await until(() => app.shown.includes("b@/users/42"), "the held page to land");

    expect(silent[0].message).toContain(
      `[SILENT_HOLD] navigation to /users/:id (/users/42) wrote "location"`
    );
    expect(attribution.holds()[0].interaction).toBeUndefined();
  });

  it("still settles a held navigation when hold tracking is off", async () => {
    arm({ holds: false });
    const app = routedApp();
    flush();
    app.resolve("a");
    await until(() => app.shown.includes("a@/users"), "initial load");

    OBSERVE!.attribution.withOrigin(NAV, () => app.setLocation("/users/42"));
    flush();
    const [nav] = attribution.navigations();
    expect(nav.outcome).toBeUndefined();
    await wait(10);
    app.resolve("b");
    await until(() => app.shown.includes("b@/users/42"), "the held page to land");

    expect(nav.outcome).toBe("held");
    expect(nav.hold).toBeUndefined(); // nothing recorded it
    expect(attribution.holds()).toEqual([]);
  });

  it("marks a navigation superseded when a later one replaces its write before it lands", async () => {
    arm();
    const app = routedApp();
    flush();
    app.resolve("a");
    await until(() => app.shown.includes("a@/users"), "initial load");

    OBSERVE!.attribution.withOrigin(NAV, () => app.setLocation("/users/42"));
    flush();
    OBSERVE!.attribution.withOrigin(
      { kind: "navigation", name: "/users/:id", to: "/users/43", params: { id: "43" } },
      () => app.setLocation("/users/43")
    );
    flush();
    const [first, second] = attribution.navigations();
    expect(first.outcome).toBe("superseded");
    expect(first.hold).toBeUndefined();
    expect(second.outcome).toBeUndefined();
    await wait(10);
    app.resolve("b");
    await until(() => app.shown.includes("b@/users/43"), "the second page to land");
    expect(second.outcome).toBe("held");
    expect(second.hold!.origin).toBe(second.origin);
    expect(attribution.navigations()).toHaveLength(2);
  });

  it("folds settled navigations into feedback().navigations by route", async () => {
    arm();
    const app = routedApp();
    flush();
    app.resolve("a");
    await until(() => app.shown.includes("a@/users"), "initial load");

    // One instant navigation, one held-and-silent, one superseded — all on one route.
    const [, setOther] = createSignal(0, { name: "other" });
    OBSERVE!.attribution.withOrigin(
      { kind: "navigation", name: "/users/:id", to: "/users/1" },
      () => setOther(1)
    );
    flush();
    OBSERVE!.attribution.withOrigin(
      { kind: "navigation", name: "/users/:id", to: "/users/2" },
      () => app.setLocation("/users/2")
    );
    flush();
    OBSERVE!.attribution.withOrigin(
      { kind: "navigation", name: "/users/:id", to: "/users/3" },
      () => app.setLocation("/users/3")
    );
    flush();
    await wait(10);
    app.resolve("b");
    await until(() => app.shown.includes("b@/users/3"), "the last page to land");

    const [row] = attribution.feedback().navigations;
    expect(row).toMatchObject({
      name: "/users/:id",
      navigations: 3,
      held: 1,
      silent: 1,
      superseded: 1
    });
    // heldMs is the hold's own clock: it opened with the superseded
    // navigation's write and the surviving one inherited it, so it can run
    // longer than the survivor's own request-to-settle time.
    expect(row.heldMs).toBeGreaterThanOrEqual(10);
    expect(row.settledMs).toBeGreaterThan(0);
    expect(row.worstMs).toBeGreaterThan(0);
  });

  it("clears its records on disable() and enable()", () => {
    arm();
    const [, setLocation] = createSignal("/a", { name: "location" });
    OBSERVE!.attribution.withOrigin({ kind: "navigation", name: "/b", to: "/b" }, () =>
      setLocation("/b")
    );
    flush();
    expect(attribution.navigations()).toHaveLength(1);
    attribution.disable();
    expect(attribution.navigations()).toEqual([]);
    arm();
    expect(attribution.navigations()).toEqual([]);
    expect(attribution.feedback().navigations).toEqual([]);
  });
});
