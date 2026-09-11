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
  isPending,
  latest,
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

  it("re-reads the ref at settle, so a coarse lazy match refined during the hold is what lands", async () => {
    const { runs, silent } = arm();
    const app = routedApp();
    flush();
    app.resolve("a");
    await until(() => app.shown.includes("a@/users"), "initial load");

    // The router only knows the lazy subtree's mount at write time.
    const ref: NavigationRef = { kind: "navigation", name: "/admin/*", to: "/admin/users/42" };
    OBSERVE!.attribution.withInteraction(CLICK, () =>
      OBSERVE!.attribution.withOrigin(ref, () => app.setLocation("/admin/users/42"))
    );
    flush();
    const [nav] = attribution.navigations();
    expect(nav.name).toBe("/admin/*");
    expect(nav.params).toBeUndefined();
    // The subtree resolves inside the hold; the router fills in the exact match.
    await wait(10);
    ref.name = "/admin/users/:id";
    ref.params = { id: "42" };
    app.resolve("b");
    await until(() => app.shown.includes("b@/admin/users/42"), "the held page to land");

    expect(nav.outcome).toBe("held");
    expect(nav).toMatchObject({ name: "/admin/users/:id", params: { id: "42" } });
    // The frame the writes stamped was updated in place: cause chains, the
    // hold's verdict and the feedback row all read the refined name.
    const run = runs.filter(r => r.nodeName === "page").at(-1)!;
    expect(run.causes[0].origin).toBe(nav.origin);
    expect(attribution.formatOrigin(nav.origin)).toBe(
      "navigation to /admin/users/:id (/admin/users/42)"
    );
    expect(silent[0].message).toContain("(navigation to /admin/users/:id (/admin/users/42))");
    expect(silent[0].data).toMatchObject({
      navigation: { name: "/admin/users/:id", params: { id: "42" } }
    });
    expect(attribution.feedback().navigations[0].name).toBe("/admin/users/:id");
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

describe("redirects — one navigation, several destinations", () => {
  const LOGIN: NavigationRef = { kind: "navigation", name: "/login", to: "/login", redirect: 1 };

  it("folds a redirect hop onto the pending navigation instead of superseding it", async () => {
    const { silent } = arm();
    const app = routedApp();
    flush();
    app.resolve("a");
    await until(() => app.shown.includes("a@/users"), "initial load");

    const before = performance.now();
    OBSERVE!.attribution.withInteraction(CLICK, () =>
      OBSERVE!.attribution.withOrigin(NAV, () => app.setLocation("/users/42"))
    );
    flush();
    await wait(10);
    // The guard behind /users/:id sends the user to /login — the click is long
    // gone, and the router knows only that a navigation is pending.
    const hopAt = performance.now();
    OBSERVE!.attribution.withOrigin(LOGIN, () => app.setLocation("/login"));
    flush();
    expect(attribution.navigations()).toHaveLength(1);
    const [nav] = attribution.navigations();
    expect(nav.outcome).toBeUndefined();
    await wait(10);
    app.resolve("b");
    await until(() => app.shown.includes("b@/login"), "the redirect target to land");

    expect(attribution.navigations()).toHaveLength(1);
    expect(nav).toMatchObject({
      name: "/login",
      to: "/login",
      from: "/users",
      writes: 2,
      outcome: "held",
      interaction: { kind: "interaction", name: "click" }
    });
    expect(nav.params).toBeUndefined();
    expect(nav.redirects).toEqual([
      { name: "/users/:id", to: "/users/42", params: { id: "42" }, at: expect.any(Number) }
    ]);
    expect(nav.redirects![0].at).toBeGreaterThanOrEqual(hopAt);
    // Timing runs from the user's request, not the hop.
    expect(nav.at).toBeGreaterThanOrEqual(before);
    expect(nav.at).toBeLessThan(hopAt);
    expect(nav.settledMs).toBeGreaterThanOrEqual(20);
    // One hold, joined by identity, named by the whole chain.
    const [hold] = attribution.holds();
    expect(nav.hold).toBe(hold);
    expect(hold.origin).toBe(nav.origin);
    expect(attribution.formatOrigin(nav.origin)).toBe(
      "navigation to /login (redirected from /users/42)"
    );
    expect(silent).toHaveLength(1);
    expect(silent[0].message).toContain(
      `[SILENT_HOLD] click on a.nav "Alice" (navigation to /login (redirected from /users/42)) wrote "location"`
    );
    expect(silent[0].data).toMatchObject({ navigation: { name: "/login", to: "/login" } });
    expect(attribution.feedback().navigations).toEqual([
      expect.objectContaining({
        name: "/login",
        navigations: 1,
        held: 1,
        redirected: 1,
        superseded: 0
      })
    ]);
  });

  it("chains successive hops in order", async () => {
    arm();
    const app = routedApp();
    flush();
    app.resolve("a");
    await until(() => app.shown.includes("a@/users"), "initial load");

    OBSERVE!.attribution.withOrigin(NAV, () => app.setLocation("/users/42"));
    flush();
    OBSERVE!.attribution.withOrigin(LOGIN, () => app.setLocation("/login"));
    flush();
    OBSERVE!.attribution.withOrigin(
      { kind: "navigation", name: "/sso", to: "/sso?next=%2Flogin", redirect: 2 },
      () => app.setLocation("/sso?next=%2Flogin")
    );
    flush();
    app.resolve("b");
    await until(() => app.shown.includes("b@/sso?next=%2Flogin"), "the final target to land");

    const [nav] = attribution.navigations();
    expect(attribution.navigations()).toHaveLength(1);
    expect(nav).toMatchObject({ name: "/sso", writes: 3, outcome: "held" });
    expect(nav.redirects!.map(h => h.to)).toEqual(["/users/42", "/login"]);
    expect(attribution.formatOrigin(nav.origin)).toBe(
      "navigation to /sso (/sso?next=%2Flogin, redirected from /users/42 → /login)"
    );
  });

  it("handles a synchronous redirect nested inside the opening frame", () => {
    const { runs } = arm();
    const [location, setLocation] = createSignal("/", { name: "location" });
    createRoot(() => createEffect(location, () => {}, { name: "reader" }));
    flush();
    OBSERVE!.attribution.withInteraction(CLICK, () =>
      OBSERVE!.attribution.withOrigin(
        { kind: "navigation", name: "/", to: "/", from: "/start" },
        () => {
          setLocation("/home");
          // A guard reading the pending location redirects before the frame closes.
          OBSERVE!.attribution.withOrigin(
            { kind: "navigation", name: "/dashboard", to: "/dashboard", redirect: 1 },
            () => setLocation("/dashboard")
          );
        }
      )
    );
    const [nav] = attribution.navigations();
    // Neither close settled it early: the outer frame was still open.
    expect(nav.outcome).toBeUndefined();
    flush();
    expect(attribution.navigations()).toHaveLength(1);
    expect(nav).toMatchObject({
      name: "/dashboard",
      from: "/start",
      writes: 2,
      outcome: "committed",
      redirects: [{ name: "/", to: "/" }]
    });
    const run = runs.filter(r => r.nodeName === "reader").at(-1)!;
    expect(run.causes[0].origin).toBe(nav.origin);
    expect(run.interaction).toMatchObject({ name: "click" });
  });

  it("opens a navigation of its own when nothing is pending to fold onto", () => {
    arm();
    const [location, setLocation] = createSignal("/", { name: "location" });
    createRoot(() => createEffect(location, () => {}, { name: "reader" }));
    flush();
    OBSERVE!.attribution.withOrigin(LOGIN, () => setLocation("/login"));
    flush();
    const [nav] = attribution.navigations();
    expect(nav).toMatchObject({ name: "/login", writes: 1, outcome: "committed" });
    expect(nav.redirects).toBeUndefined();
    expect(attribution.feedback().navigations[0].redirected).toBe(0);
  });
});

describe("hold census — a router's own reads are not acknowledgement", () => {
  /**
   * Solid Router-shaped: the router reads `latest(source)` imperatively when
   * navigating (to learn the pending target's depth) and exposes memos over
   * `isPending(source)` / `latest(source)` that only matter if the app
   * renders them. None of that is the screen saying "loading".
   */
  function routerShaped() {
    const app = routedApp();
    const pendingNavigation = createMemo(() =>
      isPending(app.location) ? latest(app.location) : undefined
    );
    const navigate = (to: string, ref: NavigationRef) => {
      // Imperative read, as navigateFromRoute does to pick up redirect depth.
      void latest(app.location);
      OBSERVE!.attribution.withOrigin(ref, () => app.setLocation(to));
    };
    return { ...app, pendingNavigation, navigate };
  }

  it("reads SILENT_HOLD, not latestOnly, when nothing renders the router's pending state", async () => {
    const { silent } = arm();
    const r = routerShaped();
    flush();
    r.resolve("a");
    await until(() => r.shown.includes("a@/users"), "initial load");

    r.navigate("/users/42", NAV);
    flush();
    await wait(10);
    r.resolve("b");
    await until(() => r.shown.includes("b@/users/42"), "the held page to land");

    const [hold] = attribution.holds();
    expect(hold.acknowledgements).toEqual([]);
    expect(silent).toHaveLength(1);
    const [source] = attribution.feedback().sources;
    expect(source).toMatchObject({ holds: 1, silent: 1, latestOnly: 0 });
    expect(attribution.feedback().navigations[0]).toMatchObject({ held: 1, silent: 1 });
  });

  it("is acknowledged once the app renders the router's pending state", async () => {
    const { silent } = arm();
    const r = routerShaped();
    createRoot(() => createRenderEffect(r.pendingNavigation, () => {}, { name: "routingBar" }));
    flush();
    r.resolve("a");
    await until(() => r.shown.includes("a@/users"), "initial load");

    r.navigate("/users/42", NAV);
    flush();
    await wait(10);
    r.resolve("b");
    await until(() => r.shown.includes("b@/users/42"), "the held page to land");

    const [hold] = attribution.holds();
    expect(hold.acknowledgements).toContainEqual(
      expect.objectContaining({ kind: "isPending", source: "location" })
    );
    expect(silent).toHaveLength(0);
    expect(attribution.feedback().navigations[0]).toMatchObject({ held: 1, silent: 0 });
  });
});

describe("at — a router whose request predates the write it wraps", () => {
  it("spans from the router's request time, not the write", async () => {
    arm();
    const app = routedApp();
    flush();
    app.resolve("a");
    await until(() => app.shown.includes("a@/users"), "initial load");
    // The router awaited its own pipeline first; the publish is the write it
    // wraps, with the user's request time carried in.
    const requested = performance.now();
    await wait(10);
    OBSERVE!.attribution.withOrigin({ ...NAV, at: requested }, () => app.setLocation("/users/42"));
    flush();
    const [nav] = attribution.navigations();
    expect(nav.at).toBe(requested);
    expect(nav.origin.at).toBe(requested);
    app.resolve("b");
    await until(() => app.shown.includes("b@/users/42"), "the held page to land");
    expect(nav.outcome).toBe("held");
    expect(nav.settledMs).toBeGreaterThanOrEqual(10);
    expect(nav.hold!.origin).toBe(nav.origin);
  });
});
