/**
 * The timeline records: `create`, `effect`, `flush`, `flight`, `fallback`.
 *
 * Claim under test: each is one record per run/callback/drain/flight/show
 * carrying the engine's own timings and the interaction the work traced to,
 * built only while a listener for its type exists, and entering no ring
 * buffer — `history("rerun")` stays re-runs only however many creations
 * happen. The live node the record is about is delivered beside it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  attribution,
  type CreateEvent,
  type EffectRunEvent,
  type FallbackEvent,
  type FlightEvent,
  type FlushEvent,
  type RerunEvent
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
import type { RecordListener, RecordType } from "../src/core/dev.js";
import type { Computed } from "../src/core/types.js";

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
    const liveOf = new WeakMap<CreateEvent, Computed<any>>();
    on("create", (e, live) => {
      creates.push(e);
      liveOf.set(e, live);
    });
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
    expect(liveOf.get(double)).toBeDefined();
    // Creations never enter the re-run history.
    expect(attribution.history("rerun")).toEqual([]);
  });

  it('is listener-gated and never enters history("rerun")', () => {
    arm();
    const { setCount } = counter();
    expect(attribution.history("rerun")).toEqual([]);
    setCount(1);
    flush();
    // The re-run is in history; no creation record was ever built.
    expect(attribution.history("rerun").map(r => r.nodeName)).toEqual(["double", "paint"]);
  });
});

describe("effect records", () => {
  it("times each effect callback and joins a re-run's callback to its compute run", () => {
    arm();
    const effects: EffectRunEvent[] = [];
    const liveOf = new WeakMap<EffectRunEvent | RerunEvent, Computed<any>>();
    on("effect", (e, live) => {
      effects.push(e);
      liveOf.set(e, live);
    });
    on("rerun", (e, live) => liveOf.set(e, live));
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
    const rerun = attribution.history("rerun").find(r => r.nodeName === "paint")!;
    expect(callback.run).toBe(rerun.run);
    expect(callback.nodeId).toBe(rerun.nodeId);
    expect(callback.at).toBeGreaterThanOrEqual(rerun.at);
    expect(callback.interaction).toBe(rerun.interaction);
    expect(callback.interaction).toMatchObject({ kind: "interaction", name: "click" });
    // Both records were delivered beside the same live node.
    expect(liveOf.get(callback)).toBeDefined();
    expect(liveOf.get(callback)).toBe(liveOf.get(rerun));
  });

  it("hands a creation's first callback the interaction that built the node", () => {
    arm();
    const effects: EffectRunEvent[] = [];
    on("effect", e => effects.push(e));
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
          if (v === 1) on("effect", e => effects.push(e));
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
    on("flush", e => flushes.push(e));
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
    on("flush", e => flushes.push(e));
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
    on("flush", e => flushes.push(e));
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
    const nodes: Computed<any>[] = [];
    on("flight", (e, live) => {
      flights.push(e);
      nodes.push(live);
    });
    const feed = pagedFeed();
    await wait(10);
    feed.resolve("a");
    await until(() => feed.shown.includes("a-p1"), "first page");
    expect(flights).toHaveLength(1);
    expect(flights[0]).toMatchObject({ nodeName: "posts", outcome: "landed" });
    expect(flights[0].durationMs).toBeGreaterThanOrEqual(8);
    expect(flights[0].interaction).toBeUndefined();
    expect(nodes[0]).toBeDefined();
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
    on("flight", e => flights.push(e));
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
    on("fallback", e => fallbacks.push(e));
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

  /** The #3540 product page: `product(id)` read by a shell effect OUTSIDE a
   * `<Loading on={id()}>` whose content reads `comments(id)`. Navigating
   * re-arms the boundary: its fallback swap is staged into id's frame, which
   * the shell holds until product lands. */
  function productPage() {
    const [id, setId] = createSignal(1, { name: "id" });
    const resolvers = {
      product: [] as ((v: string) => void)[],
      comments: [] as ((v: string) => void)[]
    };
    const view = { shell: "-", comments: "-" };
    createRoot(() => {
      const product = createMemo(
        () => {
          const v = id();
          return new Promise<string>(r => resolvers.product.push(() => r(`product ${v}`)));
        },
        { name: "product" }
      );
      const comments = createMemo(
        () => {
          const v = id();
          return new Promise<string>(r => resolvers.comments.push(() => r(`comments ${v}`)));
        },
        { name: "comments" }
      );
      createRenderEffect(product, v => void (view.shell = v), { name: "shell" });
      const boundary = createLoadingBoundary(
        () => comments(),
        () => "spinner",
        { on: id }
      );
      createRenderEffect(boundary, v => void (view.comments = String(v)), { name: "content" });
    });
    const land = (which: "product" | "comments") => resolvers[which].shift()!("");
    return { setId, view, land };
  }

  it("a re-arm whose swap the frame never committed (content landed first) is not a showing", async () => {
    arm();
    const fallbacks: FallbackEvent[] = [];
    on("fallback", e => fallbacks.push(e));
    const t = productPage();
    flush();
    t.land("product");
    t.land("comments");
    await until(() => t.view.shell === "product 1" && t.view.comments === "comments 1", "mount");
    // The mount's spinner was displayed and is a record.
    expect(fallbacks).toHaveLength(1);
    fallbacks.length = 0;

    t.setId(2);
    flush();
    // The shell holds id's frame on product; the swap is staged in it.
    expect(t.view).toEqual({ shell: "product 1", comments: "comments 1" });
    await wait(15);
    // Comments land first: the swap is cleared ahead of the commit…
    t.land("comments");
    await wait(5);
    flush();
    expect(t.view).toEqual({ shell: "product 1", comments: "comments 1" });
    // …and the whole new page commits with product, content included.
    t.land("product");
    await until(() => t.view.shell === "product 2", "navigation");
    expect(t.view).toEqual({ shell: "product 2", comments: "comments 2" });
    // The spinner was never on screen: no record — the DEV diagnostic and the
    // profiler's Fallback track would otherwise show a ~20 ms showing.
    expect(fallbacks).toEqual([]);
  });

  it("a re-arm whose swap the frame committed (shell landed first) is one showing, from the commit", async () => {
    arm();
    const fallbacks: FallbackEvent[] = [];
    on("fallback", e => fallbacks.push(e));
    const t = productPage();
    flush();
    t.land("product");
    t.land("comments");
    await until(() => t.view.comments === "comments 1", "mount");
    fallbacks.length = 0;

    t.setId(2);
    flush(); // the re-arm stages the swap — not displayed
    await wait(15);
    // Product lands: the new shell AND the spinner commit together.
    const committed = performance.now();
    t.land("product");
    await until(() => t.view.shell === "product 2", "shell");
    expect(t.view).toEqual({ shell: "product 2", comments: "spinner" });
    expect(fallbacks).toEqual([]);
    await wait(15);
    t.land("comments");
    await until(() => t.view.comments === "comments 2", "content");
    expect(fallbacks).toHaveLength(1);
    // Timed from the commit that displayed it, not from the re-arm that
    // staged it 15ms+ earlier: `at` is at or after the landing, and the
    // showing is at least the wait between landing and content.
    expect(fallbacks[0].at).toBeGreaterThanOrEqual(committed);
    expect(fallbacks[0].shownMs).toBeGreaterThanOrEqual(10);
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
    on("fallback", e => fallbacks.push(e));
    resolve("a");
    await until(() => shown.includes("a"), "content");
    expect(fallbacks).toEqual([]);
  });
});
