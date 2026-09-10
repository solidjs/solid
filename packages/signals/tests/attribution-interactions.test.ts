/**
 * Interactions as first-class records, and the typed record channel.
 *
 * Claim under test: every `withInteraction` frame yields one `InteractionEvent`
 * that settles exactly once when everything the person waited on is through
 * — the handler's return when it wrote nothing (`idle`), the drain that
 * committed its writes (`committed`), or the commit of the last hold they
 * waited in (`held`) — with the re-runs, creations, holds and navigations it
 * caused attached. `subscribe(type, …)` delivers each record kind at the
 * moment it is complete, so a consumer never polls a ring buffer to learn
 * that something finished.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { attribution } from "../src/attribution.js";
import type {
  HoldEvent,
  InteractionEvent,
  NavigationEvent,
  RerunEvent
} from "../src/attribution.js";
import {
  createEffect,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  OBSERVE
} from "../src/index.js";

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
  const delivered: { type: string; record: object }[] = [];
  attribution.subscribe("rerun", r => delivered.push({ type: "rerun", record: r }));
  attribution.subscribe("interaction", r => delivered.push({ type: "interaction", record: r }));
  attribution.subscribe("hold", r => delivered.push({ type: "hold", record: r }));
  attribution.subscribe("navigation", r => delivered.push({ type: "navigation", record: r }));
  const of = <T>(type: string) => delivered.filter(d => d.type === type).map(d => d.record as T);
  return {
    delivered,
    interactions: () => of<InteractionEvent>("interaction"),
    holds: () => of<HoldEvent>("hold"),
    navigations: () => of<NavigationEvent>("navigation"),
    reruns: () => of<RerunEvent>("rerun")
  };
}

const CLICK = { type: "click", target: 'button#next "Next →"' };

/** A controllable async source: `posts` re-fetches whenever `page` changes. */
function pagedFeed() {
  const [page, setPage] = createSignal(1, { name: "page" });
  let resolve: ((v: string) => void) | null = null;
  const posts = createMemo(
    () => {
      const p = page();
      return new Promise<string>(r => (resolve = v => r(`${v}-p${p}`)));
    },
    { name: "posts" }
  );
  const shown: string[] = [];
  createRoot(() =>
    createRenderEffect(
      posts,
      v => {
        shown.push(String(v));
      },
      { name: "feed" }
    )
  );
  return { page, setPage, shown, resolve: (v: string) => resolve!(v) };
}

describe("InteractionEvent", () => {
  it("settles idle when the handler wrote nothing, as the frame closes", () => {
    const { interactions } = arm();
    const before = performance.now();
    OBSERVE!.attribution.withInteraction(CLICK, () => {});
    const [e] = interactions();
    expect(e).toBeDefined();
    expect(e).toMatchObject({
      name: "click",
      target: CLICK.target,
      writes: 0,
      runs: 0,
      created: 0,
      outcome: "idle",
      holds: [],
      navigations: []
    });
    expect(e.at).toBeGreaterThanOrEqual(before);
    expect(e.settledMs).toBe(e.handlerMs);
    expect(attribution.interactions()).toEqual([e]);
  });

  it("stays open until the drain that committed its writes, counting the re-runs it caused", () => {
    const { interactions, reruns } = arm();
    const [count, setCount] = createSignal(0, { name: "count" });
    const doubled = createMemo(() => count() * 2, { name: "doubled" });
    createRoot(() => createEffect(doubled, () => {}, { name: "reader" }));
    flush();

    OBSERVE!.attribution.withInteraction(CLICK, () => setCount(1));
    // The handler returned; the flush that shows the write has not run.
    expect(interactions()).toHaveLength(0);
    const open = attribution.interactions()[0];
    expect(open.outcome).toBeUndefined();
    expect(open.writes).toBe(1);
    expect(open.handlerMs).toBeGreaterThanOrEqual(0);

    flush();
    const [e] = interactions();
    expect(e).toBe(open);
    expect(e.outcome).toBe("committed");
    expect(e.runs).toBe(2); // doubled + reader
    expect(e.created).toBe(0);
    expect(e.settledMs).toBeGreaterThanOrEqual(e.handlerMs);
    // Every counted run carries the frame as its interaction, and a start time.
    const mine = reruns().filter(r => r.interaction === e.origin);
    expect(mine.map(r => r.nodeName).sort()).toEqual(["doubled", "reader"]);
    for (const r of mine) expect(r.at).toBeGreaterThanOrEqual(e.at);
    expect(e.runMs).toBeCloseTo(
      mine.reduce((ms, r) => ms + r.selfMs, 0),
      6
    );
  });

  it("charges computations created in its runs to the interaction", () => {
    const { interactions } = arm();
    const [items, setItems] = createSignal<number[]>([], { name: "items" });
    // A parent whose recompute builds a child per item — the create-run shape
    // mapArray produces, which no RerunEvent ever describes.
    const rows = createMemo(() => items().map(i => createMemo(() => i, { name: `row${i}` })), {
      name: "rows"
    });
    createRoot(() =>
      createEffect(
        () => rows().map(r => r()),
        () => {},
        { name: "list" }
      )
    );
    flush();

    OBSERVE!.attribution.withInteraction(CLICK, () => setItems([1, 2, 3]));
    flush();
    const [e] = interactions();
    expect(e.outcome).toBe("committed");
    expect(e.created).toBe(3);
    expect(e.runs).toBe(2); // rows + list
  });

  it("waits for the hold its writes landed in, and attaches it", async () => {
    const { interactions, holds, delivered } = arm();
    const feed = pagedFeed();
    flush();
    feed.resolve("a");
    await until(() => feed.shown.includes("a-p1"), "initial load");

    OBSERVE!.attribution.withInteraction(CLICK, () => feed.setPage(2));
    flush();
    expect(feed.shown).toEqual(["a-p1"]); // held
    expect(interactions()).toHaveLength(0);
    await wait(10);
    feed.resolve("b");
    await until(() => feed.shown.includes("b-p2"), "the held page to land");

    const [e] = interactions();
    expect(e.outcome).toBe("held");
    expect(e.holds).toHaveLength(1);
    const [hold] = holds();
    expect(e.holds[0]).toBe(hold);
    expect(hold.interaction).toBe(e.origin);
    // The hold's clock starts at the click; the interaction settles at the commit.
    expect(hold.at).toBe(e.at);
    expect(e.settledMs).toBeGreaterThanOrEqual(hold.holdMs - 1);
    expect(e.settledMs).toBeGreaterThanOrEqual(10);
    // Bottom-up delivery: the hold before the interaction that waited on it.
    const order = delivered.filter(d => d.type !== "rerun").map(d => d.type);
    expect(order).toEqual(["hold", "interaction"]);
  });

  it("still settles held when hold tracking is off", async () => {
    const { interactions } = arm({ holds: false });
    const feed = pagedFeed();
    flush();
    feed.resolve("a");
    await until(() => feed.shown.includes("a-p1"), "initial load");

    OBSERVE!.attribution.withInteraction(CLICK, () => feed.setPage(2));
    flush();
    expect(interactions()).toHaveLength(0);
    feed.resolve("b");
    await until(() => feed.shown.includes("b-p2"), "the held page to land");
    const [e] = interactions();
    expect(e.outcome).toBe("held");
    expect(e.holds).toEqual([]);
  });

  it("attaches the navigation it performed and settles with it", async () => {
    const { interactions, navigations, delivered } = arm();
    const feed = pagedFeed();
    flush();
    feed.resolve("a");
    await until(() => feed.shown.includes("a-p1"), "initial load");

    OBSERVE!.attribution.withInteraction(CLICK, () =>
      OBSERVE!.attribution.withOrigin(
        { kind: "navigation", name: "/feed/:page", to: "/feed/2", params: { page: "2" } },
        () => feed.setPage(2)
      )
    );
    flush();
    expect(interactions()).toHaveLength(0);
    expect(attribution.interactions()[0].navigations).toHaveLength(1);
    feed.resolve("b");
    await until(() => feed.shown.includes("b-p2"), "the held page to land");

    const [e] = interactions();
    const [nav] = navigations();
    expect(e.navigations[0]).toBe(nav);
    expect(nav).toBe(attribution.navigations()[0]);
    expect(nav.outcome).toBe("held");
    expect(nav.interaction).toBe(e.origin);
    expect(e.outcome).toBe("held");
    const order = delivered.filter(d => d.type !== "rerun").map(d => d.type);
    expect(order).toEqual(["hold", "navigation", "interaction"]);
  });

  it("keeps one record per dispatch where feedback() folds by name", () => {
    const { interactions } = arm();
    const [count, setCount] = createSignal(0, { name: "count" });
    createRoot(() => createEffect(count, () => {}, { name: "reader" }));
    flush();
    OBSERVE!.attribution.withInteraction(CLICK, () => setCount(1));
    flush();
    OBSERVE!.attribution.withInteraction(CLICK, () => setCount(2));
    flush();
    expect(interactions()).toHaveLength(2);
    expect(attribution.interactions()).toHaveLength(2);
    expect(attribution.feedback().interactions).toHaveLength(1);
    expect(attribution.feedback().interactions[0].dispatches).toBe(2);
  });
});

describe("subscribe(type, listener)", () => {
  it("the bare form is the rerun channel; unsubscribe and disable() drop listeners", () => {
    arm();
    const bare: RerunEvent[] = [];
    const typed: RerunEvent[] = [];
    const off = attribution.subscribe(r => bare.push(r));
    attribution.subscribe("rerun", r => typed.push(r));
    const [count, setCount] = createSignal(0, { name: "count" });
    createRoot(() => createEffect(count, () => {}, { name: "reader" }));
    flush();
    setCount(1);
    flush();
    expect(bare).toHaveLength(1);
    expect(typed).toEqual(bare);
    off();
    setCount(2);
    flush();
    expect(bare).toHaveLength(1);
    expect(typed).toHaveLength(2);
    attribution.disable();
    attribution.enable({ log: false });
    setCount(3);
    flush();
    expect(typed).toHaveLength(2);
  });
});
