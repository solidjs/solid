/**
 * Interactions as first-class records, and the typed record channel.
 *
 * Claim under test: every `withInteraction` frame yields one `InteractionEvent`
 * that settles exactly once when everything the person waited on is through
 * — the handler's return when it wrote nothing (`idle`), the drain that
 * committed its writes (`committed`), or the commit of the last hold they
 * waited in (`held`) — with the re-runs, creations, holds and navigations it
 * caused attached. `OBSERVE.records.subscribe(type, …)` delivers each record
 * kind at the moment it is complete, so a consumer never polls a ring buffer
 * to learn that something finished.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { attribution, feedback } from "../src/attribution.js";
import type {
  HoldEvent,
  InteractionEvent,
  NavigationEvent,
  RerunEvent
} from "../src/attribution.js";
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
  on("rerun", r => delivered.push({ type: "rerun", record: r }));
  on("interaction", r => delivered.push({ type: "interaction", record: r }));
  on("hold", r => delivered.push({ type: "hold", record: r }));
  on("navigation", r => delivered.push({ type: "navigation", record: r }));
  const of = <T>(type: string) => delivered.filter(d => d.type === type).map(d => d.record as T);
  return {
    delivered,
    interactionLog: () => of<InteractionEvent>("interaction"),
    holds: () => of<HoldEvent>("hold"),
    navigationLog: () => of<NavigationEvent>("navigation"),
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
    const { interactionLog } = arm();
    const before = performance.now();
    OBSERVE!.attribution.withInteraction(CLICK, () => {});
    const [e] = interactionLog();
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
    expect(e.inputDelayMs).toBeUndefined();
    expect(e.settledMs).toBe(e.handlerMs);
    expect(attribution.history("interaction")).toEqual([e]);
  });

  it("dates itself from the runtime's `at` and reports the gap to handler entry as input delay", () => {
    const { interactionLog } = arm();
    const at = performance.now() - 20;
    OBSERVE!.attribution.withInteraction({ ...CLICK, at }, () => {});
    const [e] = interactionLog();
    expect(e.at).toBe(at);
    expect(e.inputDelayMs).toBeGreaterThanOrEqual(20);
    // The handler ran for next to nothing; what the person waited was the queue.
    expect(e.handlerMs).toBeLessThan(e.inputDelayMs!);
    expect(e.settledMs).toBeCloseTo(e.inputDelayMs! + e.handlerMs, 6);
    expect(e.outcome).toBe("idle");
  });

  it("stays open until the drain that committed its writes, counting the re-runs it caused", () => {
    const { interactionLog, reruns } = arm();
    const [count, setCount] = createSignal(0, { name: "count" });
    const doubled = createMemo(() => count() * 2, { name: "doubled" });
    createRoot(() => createEffect(doubled, () => {}, { name: "reader" }));
    flush();

    OBSERVE!.attribution.withInteraction(CLICK, () => setCount(1));
    // The handler returned; the flush that shows the write has not run.
    expect(interactionLog()).toHaveLength(0);
    const open = attribution.history("interaction")[0];
    expect(open.outcome).toBeUndefined();
    expect(open.writes).toBe(1);
    expect(open.handlerMs).toBeGreaterThanOrEqual(0);

    flush();
    const [e] = interactionLog();
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
    const { interactionLog } = arm();
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
    const [e] = interactionLog();
    expect(e.outcome).toBe("committed");
    expect(e.created).toBe(3);
    expect(e.runs).toBe(2); // rows + list
  });

  it("waits for the hold its writes landed in, and attaches it", async () => {
    const { interactionLog, holds, delivered } = arm();
    const feed = pagedFeed();
    flush();
    feed.resolve("a");
    await until(() => feed.shown.includes("a-p1"), "initial load");

    OBSERVE!.attribution.withInteraction(CLICK, () => feed.setPage(2));
    flush();
    expect(feed.shown).toEqual(["a-p1"]); // held
    expect(interactionLog()).toHaveLength(0);
    // Bracket the wait on the engine's own clock: a 10ms timer can fire a
    // hair under 10ms of `performance.now()`.
    const armed = performance.now();
    await wait(10);
    const waited = performance.now() - armed;
    feed.resolve("b");
    await until(() => feed.shown.includes("b-p2"), "the held page to land");

    const [e] = interactionLog();
    expect(e.outcome).toBe("held");
    expect(e.holds).toHaveLength(1);
    const [hold] = holds();
    expect(e.holds[0]).toBe(hold);
    expect(hold.interaction).toBe(e.origin);
    // The hold's clock starts at the click; the interaction settles at the commit.
    expect(hold.at).toBe(e.at);
    expect(e.settledMs).toBeGreaterThanOrEqual(hold.holdMs - 1);
    expect(e.settledMs).toBeGreaterThanOrEqual(waited);
    // Bottom-up delivery: the hold before the interaction that waited on it.
    const order = delivered.filter(d => d.type !== "rerun").map(d => d.type);
    expect(order).toEqual(["hold", "interaction"]);
  });

  it("still settles held when hold tracking is off", async () => {
    const { interactionLog } = arm({ holds: false });
    const feed = pagedFeed();
    flush();
    feed.resolve("a");
    await until(() => feed.shown.includes("a-p1"), "initial load");

    OBSERVE!.attribution.withInteraction(CLICK, () => feed.setPage(2));
    flush();
    expect(interactionLog()).toHaveLength(0);
    feed.resolve("b");
    await until(() => feed.shown.includes("b-p2"), "the held page to land");
    const [e] = interactionLog();
    expect(e.outcome).toBe("held");
    expect(e.holds).toEqual([]);
  });

  it("attaches the navigation it performed and settles with it", async () => {
    const { interactionLog, navigationLog, delivered } = arm();
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
    expect(interactionLog()).toHaveLength(0);
    expect(attribution.history("interaction")[0].navigations).toHaveLength(1);
    feed.resolve("b");
    await until(() => feed.shown.includes("b-p2"), "the held page to land");

    const [e] = interactionLog();
    const [nav] = navigationLog();
    expect(e.navigations[0]).toBe(nav);
    expect(nav).toBe(attribution.history("navigation")[0]);
    expect(nav.outcome).toBe("held");
    expect(nav.interaction).toBe(e.origin);
    expect(e.outcome).toBe("held");
    const order = delivered.filter(d => d.type !== "rerun").map(d => d.type);
    expect(order).toEqual(["hold", "navigation", "interaction"]);
  });

  it("keeps one record per dispatch where feedback() folds by name", () => {
    const { interactionLog } = arm();
    const [count, setCount] = createSignal(0, { name: "count" });
    createRoot(() => createEffect(count, () => {}, { name: "reader" }));
    flush();
    OBSERVE!.attribution.withInteraction(CLICK, () => setCount(1));
    flush();
    OBSERVE!.attribution.withInteraction(CLICK, () => setCount(2));
    flush();
    expect(interactionLog()).toHaveLength(2);
    expect(attribution.history("interaction")).toHaveLength(2);
    expect(feedback().interactions).toHaveLength(1);
    expect(feedback().interactions[0].dispatches).toBe(2);
  });
});

describe("a handler that returns a promise", () => {
  function armWithFindings(
    holds: { infoMs: number; warnMs: number } | false = { infoMs: 0, warnMs: 0 }
  ) {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    attribution.enable({ log: false, hotRuns: false, hotTime: false, waterfalls: false, holds });
    const records: InteractionEvent[] = [];
    on("interaction", r => records.push(r));
    const findings: DiagnosticEvent[] = [];
    const off = OBSERVE!.diagnostics.subscribe(e => {
      if (e.code === "UNTRACKED_ASYNC_HANDLER") findings.push(e);
    });
    offs.push(off);
    return { interactionLog: () => records, findings };
  }

  it("keeps the record open until the promise settles and reports the continuation", async () => {
    const { interactionLog } = armWithFindings();
    let resolve!: () => void;
    const pending = new Promise<void>(r => (resolve = r));
    OBSERVE!.attribution.withInteraction(CLICK, async () => {
      await pending;
    });
    flush();
    // The frame closed, but the person is still waiting.
    expect(interactionLog()).toHaveLength(0);
    expect(attribution.history("interaction")[0]?.settledMs).toBeUndefined();
    await wait(30);
    resolve();
    await until(() => interactionLog().length === 1, "the handler's promise to settle the record");
    const [e] = interactionLog();
    expect(e.continuationMs).toBeGreaterThanOrEqual(25);
    expect(e.settledMs).toBeGreaterThanOrEqual(
      (e.inputDelayMs ?? 0) + e.handlerMs + e.continuationMs!
    );
    expect(e.outcome).toBe("idle");
  });

  it("a rejected handler promise ends the wait too", async () => {
    const { interactionLog } = armWithFindings();
    const failing = OBSERVE!.attribution.withInteraction(CLICK, async () => {
      await wait(5);
      throw new Error("save failed");
    });
    await failing.catch(() => {});
    await until(() => interactionLog().length === 1, "the rejected promise to settle the record");
    expect(interactionLog()[0].continuationMs).toBeGreaterThanOrEqual(4);
  });

  it("finds a handler that awaited with nothing on screen able to show it", async () => {
    const { interactionLog, findings } = armWithFindings({ infoMs: 10, warnMs: 20 });
    const [, setResult] = createSignal("", { name: "result" });
    // `onClick={async () => setResult(await save())}`: no write before the await.
    OBSERVE!.attribution.withInteraction(CLICK, async () => {
      await wait(30);
      setResult("saved");
    });
    await until(() => interactionLog().length === 1, "the record to settle");
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: "UNTRACKED_ASYNC_HANDLER",
      kind: "responsiveness",
      severity: "warn",
      data: { interaction: { type: "click", target: CLICK.target }, capped: false }
    });
    expect(findings[0].message).toContain("click on button#next");
    expect(findings[0].message).toContain("action()");
    expect((findings[0].data as { continuationMs: number }).continuationMs).toBeGreaterThanOrEqual(
      25
    );
  });

  it("stays quiet below the hold threshold, and info between the two", async () => {
    // The verdict is cut against `continuationMs`: two `performance.now()`
    // reads in the engine, at the handler's return and at its promise's
    // settle. On the wall clock a 1ms wait crossed `infoMs: 10` on the
    // coverage-instrumented CI job (12× slower than a local run), so the
    // clock is the test's here (the #3598 pattern): it stands still unless
    // the handler advances it, and each side of the threshold is exercised
    // by choice. Real timers still drive the await; only the stamps are ours.
    let t = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => t);
    const { interactionLog, findings } = armWithFindings({ infoMs: 10, warnMs: 1000 });
    OBSERVE!.attribution.withInteraction(CLICK, async () => {
      await wait(1);
      t += 9; // one short of infoMs
    });
    await until(() => interactionLog().length === 1, "the fast handler to settle");
    expect(interactionLog()[0].continuationMs).toBe(9);
    expect(findings).toHaveLength(0);
    OBSERVE!.attribution.withInteraction(CLICK, async () => {
      await wait(1);
      t += 30; // past infoMs, short of warnMs
    });
    await until(() => interactionLog().length === 2, "the slow handler to settle");
    expect(interactionLog()[1].continuationMs).toBe(30);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("info");
  });

  it("a write before the await is the acknowledgement: no finding", async () => {
    const { interactionLog, findings } = armWithFindings({ infoMs: 10, warnMs: 20 });
    const [saving, setSaving] = createSignal(false, { name: "saving" });
    createRoot(() => createRenderEffect(saving, () => {}, { name: "spinner" }));
    flush();
    OBSERVE!.attribution.withInteraction(CLICK, async () => {
      setSaving(true);
      await wait(30);
      setSaving(false);
    });
    await until(() => interactionLog().length === 1, "the record to settle");
    expect(findings).toHaveLength(0);
    expect(interactionLog()[0]).toMatchObject({ writes: 1, outcome: "committed" });
    expect(interactionLog()[0].continuationMs).toBeGreaterThanOrEqual(25);
  });

  it("an action started in the handler is tracked work: no finding", async () => {
    const { interactionLog, findings } = armWithFindings({ infoMs: 10, warnMs: 20 });
    const [, setResult] = createSignal("", { name: "result" });
    const save = action(function* save() {
      yield wait(30);
      setResult("saved");
    });
    OBSERVE!.attribution.withInteraction(CLICK, () => save());
    await until(() => interactionLog().length === 1, "the action-backed handler to settle");
    expect(findings).toHaveLength(0);
  });

  it("with hold tracking off, the record still waits but nothing is judged", async () => {
    const { interactionLog, findings } = armWithFindings(false);
    OBSERVE!.attribution.withInteraction(CLICK, async () => {
      await wait(20);
    });
    await until(() => interactionLog().length === 1, "the record to settle");
    expect(interactionLog()[0].continuationMs).toBeGreaterThanOrEqual(15);
    expect(findings).toHaveLength(0);
  });
});

describe("OBSERVE.records.subscribe(type, listener)", () => {
  it("unsubscribe stops delivery; disable() uninstalls the engine but keeps the subscription", () => {
    arm();
    const first: RerunEvent[] = [];
    const second: RerunEvent[] = [];
    const off = OBSERVE!.records.subscribe("rerun", r => first.push(r));
    on("rerun", r => second.push(r));
    const [count, setCount] = createSignal(0, { name: "count" });
    createRoot(() => createEffect(count, () => {}, { name: "reader" }));
    flush();
    setCount(1);
    flush();
    expect(first).toHaveLength(1);
    expect(second).toEqual(first);
    off();
    setCount(2);
    flush();
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(2);
    // The subscription is the channel's, not the engine's: with the engine
    // uninstalled nothing is emitted, and the listener hears the next
    // engine's records without resubscribing.
    attribution.disable();
    setCount(3);
    flush();
    expect(second).toHaveLength(2);
    attribution.enable({ log: false });
    setCount(4);
    flush();
    expect(second).toHaveLength(3);
  });
});
