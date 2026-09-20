/**
 * The timeline records: `create`, `effect`, `flush`, `flight`, `fallback`.
 *
 * Claim under test: each is one record per run/callback/drain/flight/show
 * carrying the engine's own timings and the interaction the work traced to,
 * built only while a listener for its type exists, and entering no ring
 * buffer — `history()` stays re-runs only however many creations happen.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  attribution,
  type CreateEvent,
  type EffectRunEvent,
  type FallbackEvent,
  type FlightEvent,
  type FlushEvent
} from "../src/attribution.js";
import {
  createLoadingBoundary,
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
    await wait(1);
  }
}

function arm() {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  attribution.enable({ log: false, checks: false, waterfalls: false });
}

const CLICK = { type: "click", target: 'button#next "Next →"' };
const click = <T>(fn: () => T) => OBSERVE!.attribution.withInteraction(CLICK, fn);

/** A counter with one memo and one render effect on it, names fixed. */
function counter() {
  const [count, setCount] = createSignal(0, { name: "count" });
  const shown: number[] = [];
  createRoot(() => {
    const double = createMemo(() => count() * 2, { name: "double" });
    createRenderEffect(
      double,
      v => {
        shown.push(v);
      },
      { name: "paint" }
    );
  });
  flush();
  return { count, setCount, shown };
}

describe("create records", () => {
  it("delivers one record per creation run with the interaction that built the node", () => {
    arm();
    const creates: CreateEvent[] = [];
    attribution.subscribe("create", e => creates.push(e));
    const [count] = createSignal(1, { name: "count" });
    click(() => {
      createRoot(() => {
        const double = createMemo(() => count() * 2, { name: "double" });
        createRenderEffect(double, () => {}, { name: "paint" });
      });
    });
    flush();
    expect(creates.map(c => [c.nodeName, c.nodeKind])).toEqual([
      ["double", "memo"],
      ["paint", "effect"]
    ]);
    const [double, paint] = creates;
    expect(double.depCount).toBe(1);
    expect(paint.depCount).toBe(1);
    expect(double.selfMs).toBeGreaterThanOrEqual(0);
    expect(double.totalMs).toBeGreaterThanOrEqual(double.selfMs);
    expect(double.phase).toBe("plain");
    expect(double.held).toBe(false);
    expect(double.interaction).toMatchObject({ kind: "interaction", name: "click" });
    expect(paint.interaction).toBe(double.interaction);
    expect(typeof double.nodeId).toBe("number");
    expect(OBSERVE!.subjectOf(double)).toBeDefined();
    // Creations never enter the re-run history.
    expect(attribution.history()).toEqual([]);
  });

  it("is listener-gated and never enters history()", () => {
    arm();
    const { setCount } = counter();
    expect(attribution.history()).toEqual([]);
    setCount(1);
    flush();
    // The re-run is in history; no creation record was ever built.
    expect(attribution.history().map(r => r.nodeName)).toEqual(["double", "paint"]);
  });
});

describe("effect records", () => {
  it("times each effect callback and joins a re-run's callback to its compute run", () => {
    arm();
    const effects: EffectRunEvent[] = [];
    attribution.subscribe("effect", e => effects.push(e));
    const { setCount } = counter();
    // The creation's first callback: timed, no run to join to.
    expect(effects).toHaveLength(1);
    expect(effects[0]).toMatchObject({ nodeName: "paint" });
    expect(effects[0].run).toBeUndefined();
    expect(effects[0].durationMs).toBeGreaterThanOrEqual(0);
    click(() => setCount(1));
    flush();
    expect(effects).toHaveLength(2);
    const callback = effects[1];
    const rerun = attribution.history().find(r => r.nodeName === "paint")!;
    expect(callback.run).toBe(rerun.run);
    expect(callback.nodeId).toBe(rerun.nodeId);
    expect(callback.at).toBeGreaterThanOrEqual(rerun.at);
    expect(callback.interaction).toBe(rerun.interaction);
    expect(callback.interaction).toMatchObject({ kind: "interaction", name: "click" });
    expect(OBSERVE!.subjectOf(callback)).toBe(OBSERVE!.subjectOf(rerun));
  });

  it("hands a creation's first callback the interaction that built the node", () => {
    arm();
    const effects: EffectRunEvent[] = [];
    attribution.subscribe("effect", e => effects.push(e));
    const [count] = createSignal(1, { name: "count" });
    click(() => {
      createRoot(() => createRenderEffect(count, () => {}, { name: "paint" }));
    });
    flush();
    expect(effects).toHaveLength(1);
    expect(effects[0].interaction).toMatchObject({ kind: "interaction", name: "click" });
  });

  it("a listener arriving mid-callback gets no record for that callback", () => {
    arm();
    const effects: EffectRunEvent[] = [];
    const [count, setCount] = createSignal(0, { name: "count" });
    createRoot(() =>
      createRenderEffect(
        count,
        v => {
          if (v === 1) attribution.subscribe("effect", e => effects.push(e));
        },
        { name: "paint" }
      )
    );
    flush();
    setCount(1);
    flush();
    expect(effects).toEqual([]);
    setCount(2);
    flush();
    expect(effects).toHaveLength(1);
  });
});

describe("flush records", () => {
  it("delivers one record per drain with its run counts and the one interaction it served", () => {
    arm();
    const flushes: FlushEvent[] = [];
    attribution.subscribe("flush", e => flushes.push(e));
    const { setCount } = counter();
    expect(flushes).toEqual([]);
    click(() => setCount(1));
    flush();
    expect(flushes).toHaveLength(1);
    expect(flushes[0]).toMatchObject({ runs: 2, created: 0, held: false });
    expect(flushes[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(flushes[0].interaction).toMatchObject({ kind: "interaction", name: "click" });
    // A no-op flush is not a drain.
    flush();
    expect(flushes).toHaveLength(1);
  });

  it("counts creations, and drops the interaction when runs for two share a drain", () => {
    arm();
    const flushes: FlushEvent[] = [];
    attribution.subscribe("flush", e => flushes.push(e));
    const a = counter();
    const b = counter();
    flushes.length = 0;
    click(() => a.setCount(1));
    OBSERVE!.attribution.withInteraction({ type: "keydown" }, () => b.setCount(1));
    flush();
    expect(flushes).toHaveLength(1);
    expect(flushes[0].runs).toBe(4);
    expect(flushes[0].interaction).toBeUndefined();
    // A creation inside the drain counts as created, not as a run: a node
    // born inside a re-run (a list growing a row) is the case.
    const [flag, setFlag] = createSignal(false, { name: "flag" });
    createRoot(() =>
      createRenderEffect(
        () => {
          if (flag()) createMemo(() => 1, { name: "row" })();
        },
        () => {},
        { name: "host" }
      )
    );
    flush();
    flushes.length = 0;
    setFlag(true);
    flush();
    expect(flushes).toHaveLength(1);
    expect(flushes[0]).toMatchObject({ runs: 1, created: 1 });
  });

  it("marks a drain that parked a transition as held", async () => {
    arm();
    const flushes: FlushEvent[] = [];
    attribution.subscribe("flush", e => flushes.push(e));
    const [page, setPage] = createSignal(1, { name: "page" });
    let resolve!: (v: string) => void;
    const shown: string[] = [];
    createRoot(() => {
      const posts = createMemo(
        () => {
          const p = page();
          return new Promise<string>(r => (resolve = v => r(`${v}-p${p}`)));
        },
        { name: "posts" }
      );
      createRenderEffect(
        posts,
        v => {
          shown.push(String(v));
        },
        { name: "feed" }
      );
    });
    flush();
    resolve("a");
    await until(() => shown.includes("a-p1"), "first page");
    flushes.length = 0;
    // An async re-run parks its transition until the flight lands.
    setPage(2);
    flush();
    expect(flushes).toHaveLength(1);
    expect(flushes[0].held).toBe(true);
    resolve("b");
    await until(() => shown.includes("b-p2"), "second page");
    expect(flushes.at(-1)!.held).toBe(false);
  });
});

describe("flight records", () => {
  function pagedFeed() {
    const [page, setPage] = createSignal(1, { name: "page" });
    let resolve!: (v: string) => void;
    const shown: string[] = [];
    createRoot(() => {
      const posts = createMemo(
        () => {
          const p = page();
          return new Promise<string>(r => (resolve = v => r(`${v}-p${p}`)));
        },
        { name: "posts" }
      );
      createRenderEffect(
        posts,
        v => {
          shown.push(String(v));
        },
        { name: "feed" }
      );
    });
    flush();
    return { setPage, shown, resolve: (v: string) => resolve(v) };
  }

  it("delivers a landed record per flight with its wall time and interaction", async () => {
    arm();
    const flights: FlightEvent[] = [];
    attribution.subscribe("flight", e => flights.push(e));
    const feed = pagedFeed();
    await wait(10);
    feed.resolve("a");
    await until(() => feed.shown.includes("a-p1"), "first page");
    expect(flights).toHaveLength(1);
    expect(flights[0]).toMatchObject({ nodeName: "posts", outcome: "landed" });
    expect(flights[0].durationMs).toBeGreaterThanOrEqual(8);
    expect(flights[0].interaction).toBeUndefined();
    expect(OBSERVE!.subjectOf(flights[0])).toBeDefined();
    click(() => feed.setPage(2));
    flush();
    feed.resolve("b");
    await until(() => feed.shown.includes("b-p2"), "second page");
    expect(flights).toHaveLength(2);
    expect(flights[1].outcome).toBe("landed");
    expect(flights[1].interaction).toMatchObject({ kind: "interaction", name: "click" });
    expect(flights[1].nodeId).toBe(flights[0].nodeId);
  });

  it("delivers an abandoned record when the node's next flight supersedes one in the air", async () => {
    arm();
    const flights: FlightEvent[] = [];
    attribution.subscribe("flight", e => flights.push(e));
    const feed = pagedFeed();
    feed.setPage(2);
    flush();
    expect(flights).toHaveLength(1);
    expect(flights[0]).toMatchObject({ nodeName: "posts", outcome: "abandoned" });
    expect(flights[0].durationMs).toBeGreaterThanOrEqual(0);
    feed.resolve("b");
    await until(() => feed.shown.includes("b-p2"), "second page");
    expect(flights.map(f => f.outcome)).toEqual(["abandoned", "landed"]);
    // The abandoned flight ended when the next one began.
    expect(flights[0].at + flights[0].durationMs).toBeLessThanOrEqual(flights[1].at + 0.001);
  });
});

describe("fallback records", () => {
  it("delivers one record per showing, when the fallback hides", async () => {
    arm();
    const fallbacks: FallbackEvent[] = [];
    attribution.subscribe("fallback", e => fallbacks.push(e));
    const [page, setPage] = createSignal(1, { name: "page" });
    let resolve!: (v: string) => void;
    const shown: string[] = [];
    createRoot(() => {
      const posts = createMemo(
        () => {
          const p = page();
          return new Promise<string>(r => (resolve = v => r(`${v}-p${p}`)));
        },
        { name: "posts" }
      );
      const view = createLoadingBoundary(
        () => posts(),
        () => "loading…"
      );
      createRenderEffect(
        view,
        v => {
          shown.push(String(v));
        },
        { name: "view" }
      );
    });
    flush();
    expect(shown).toEqual(["loading…"]);
    expect(fallbacks).toEqual([]);
    await wait(15);
    resolve("a");
    await until(() => shown.includes("a-p1"), "content");
    expect(fallbacks).toHaveLength(1);
    expect(fallbacks[0].shownMs).toBeGreaterThanOrEqual(10);
    expect(fallbacks[0].at).toBeGreaterThan(0);
    // Not a user's wait: the boundary showed on mount.
    expect(fallbacks[0].interaction).toBeUndefined();
    void setPage;
  });

  it("is listener-gated: a show with no listener produces nothing at hide", async () => {
    arm();
    const fallbacks: FallbackEvent[] = [];
    let resolve!: (v: string) => void;
    const shown: string[] = [];
    createRoot(() => {
      const posts = createMemo(() => new Promise<string>(r => (resolve = r)), { name: "posts" });
      const view = createLoadingBoundary(
        () => posts(),
        () => "loading…"
      );
      createRenderEffect(
        view,
        v => {
          shown.push(String(v));
        },
        { name: "view" }
      );
    });
    flush();
    attribution.subscribe("fallback", e => fallbacks.push(e));
    resolve("a");
    await until(() => shown.includes("a"), "content");
    expect(fallbacks).toEqual([]);
  });
});
