/**
 * DESIGN EVALUATION — async waterfall attribution.
 *
 * Claim under test: a chain link is asserted only when it is graph-provable
 * AND origin-provable — flight B chains to flight A only if B's recompute was
 * caused by A's landing (cause chain) and B's work provably did not exist
 * before A resolved (origin registry: cooperative markFlight, first-seen
 * identity, else registration time). Preloads we cannot see are absolved by
 * the duration gate when settled, by origin comparison when marked/seen, and
 * acknowledged as the residual blind spot otherwise (depth-2 => info).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { attribution } from "../src/attribution.js";
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
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const sleep = <T>(ms: number, v: T) => new Promise<T>(r => setTimeout(() => r(v), ms));
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * The tests that check the chain's MEASUREMENT (`expectSerialized`) run on a
 * fake clock that covers `performance.now()` — the engine's own clock (see
 * `now()` in core/attribution.ts) — so a flight's origin and landing stamps,
 * and the test's observation window, all read the same frozen time. Every
 * `advance(ms)` is then exactly `ms` on both. On the wall clock the window
 * raced the stamps: the origin is stamped when the memo RUNS (inside the
 * flush, after `t0`), and a loaded runner stretched the run and the timer
 * callbacks by several ms each, so the summed link times exceeded the window
 * (`46.9 <= 45.1`, `35.6 <= 31.3` on CI).
 */
function fakeClock() {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"]
  });
}
async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
  flush();
}

/**
 * Deadline-poll a condition instead of sleeping a fixed interval: the sleeps
 * above are real timers, and fixed waits raced them on loaded CI runners
 * (three flake incidents on docs-only commits). Positive expectations poll
 * until their event exists; negative expectations poll until the terminal
 * flight has provably LANDED (observed via the reading effect), then assert
 * absence after one more settle turn.
 */
async function until(cond: () => boolean, what: string, timeout = 5000) {
  const start = Date.now();
  for (;;) {
    flush();
    if (cond()) return;
    if (Date.now() - start > timeout) throw new Error(`timed out waiting for ${what}`);
    await wait(5);
  }
}

function arm(minFlightMs = 5) {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  attribution.enable({
    log: false,
    hotRuns: false,
    hotTime: false,
    waterfalls: { minFlightMs }
  });
  const events: DiagnosticEvent[] = [];
  OBSERVE!.diagnostics.subscribe(e => {
    if (e.code === "ASYNC_WATERFALL") events.push(e);
  });
  return events;
}

const chainNames = (e: DiagnosticEvent) => (e.data!.chain as { name: string }[]).map(l => l.name);

/**
 * `sequentialMs` is the SUM of the chain's per-link flight times, each of
 * which the engine measured on its own clock (`performance.now()` at flight
 * start and landing). What the number pins is the serialization: every
 * link's time is counted, each link was a real wait, and the total is no
 * more than the window the test observed on the SAME clock. Under
 * `fakeClock()` the window is exact — the chain's flights ran back to back
 * for the whole of it, so the sum can equal the window but never exceed it.
 */
function expectSerialized(e: DiagnosticEvent, observedMs: number) {
  const links = e.data!.chain as { ms: number }[];
  const sum = links.reduce((acc, l) => acc + l.ms, 0);
  expect(e.data!.sequentialMs as number).toBeCloseTo(sum, 6);
  for (const l of links) expect(l.ms).toBeGreaterThan(0);
  expect(e.data!.sequentialMs as number).toBeLessThanOrEqual(observedMs);
}

describe("ASYNC_WATERFALL", () => {
  it("catches the lazy dependent fetch (story -> author) at info severity", async () => {
    fakeClock();
    const events = arm();
    const [id, setId] = createSignal(1, { name: "storyId" });
    const story = createMemo(() => sleep(15, `story-${id()}`), { name: "story" });
    const author = createMemo(
      () => {
        const s = story(); // throws NotReady until story lands — the lazy chain
        return sleep(15, `${s}-author`);
      },
      { name: "author" }
    );
    const t0 = performance.now();
    createRoot(() =>
      createEffect(
        () => author(),
        () => {},
        { name: "page" }
      )
    );
    flush();
    // +15: story lands; only now does author's flight start — the lazy chain.
    await advance(15);
    expect(events).toHaveLength(0);
    // +30: author lands; the verdict.
    await advance(15);
    const observed = performance.now() - t0;
    expect(observed).toBe(30); // the fake clock covers performance.now()

    expect(events).toHaveLength(1);
    expect(events[0].severity).toBe("info"); // depth 2: advisory, not accusatory
    expect(events[0].nodeName).toBe("author");
    expect(chainNames(events[0])).toEqual(["story", "author"]);
    expectSerialized(events[0], observed);

    // The fact surface has it too.
    const chains = attribution.history("waterfall");
    expect(chains.some(c => c.chain.map(l => l.name).join(">") === "story>author")).toBe(true);
    void setId;
  });

  it("escalates a 3-deep chain to warn severity with the full path", async () => {
    fakeClock();
    const events = arm();
    const a = createMemo(() => sleep(12, "a"), { name: "fetch-a" });
    const b = createMemo(() => sleep(12, a() + "b"), { name: "fetch-b" });
    const c = createMemo(() => sleep(12, b() + "c"), { name: "fetch-c" });
    const t0 = performance.now();
    createRoot(() =>
      createEffect(
        () => c(),
        () => {},
        { name: "page" }
      )
    );
    flush();
    // +12: a lands, b starts. +24: b lands (a depth-2 advisory), c starts.
    await advance(12);
    await advance(12);
    expect(events.some(e => e.severity === "warn")).toBe(false);
    // +36: c lands — the depth-3 escalation.
    await advance(12);
    const observed = performance.now() - t0;
    expect(observed).toBe(36); // the fake clock covers performance.now()

    const worst = events.at(-1)!;
    expect(worst.severity).toBe("warn");
    expect(chainNames(worst)).toEqual(["fetch-a", "fetch-b", "fetch-c"]);
    expectSerialized(worst, observed);
  });

  it("does not flag a dependent whose promise was preloaded (markFlight)", async () => {
    const events = arm();
    // Route preloader shape: the author request is kicked off at navigation
    // time, in parallel with story. The memo later picks up the SAME promise.
    const preloadedAuthor = sleep(30, "author-preloaded");
    attribution.markFlight(preloadedAuthor);

    const story = createMemo(() => sleep(15, "story"), { name: "story" });
    const author = createMemo(
      () => {
        story(); // still graph-caused by story's landing...
        return preloadedAuthor; // ...but the work predates it: parallel.
      },
      { name: "author" }
    );
    let landed: unknown;
    createRoot(() =>
      createEffect(
        () => author(),
        v => {
          landed = v;
        },
        { name: "page" }
      )
    );
    flush();
    await until(() => landed === "author-preloaded", "the preloaded author landing");
    await wait(10); // one extra settle turn: a late advisory would fire here
    flush();

    expect(events).toHaveLength(0);
    // Not even recorded as a chain fact — the origin test broke the link.
    expect(attribution.history("waterfall")).toHaveLength(0);
  });

  it("does not flag an already-settled cached dependent (duration gate)", async () => {
    // Both links must each clear the gate for a verdict. The gate sits far
    // above what a resolved promise's landing can take on a loaded CI runner
    // (a 5ms gate flaked there), and story sits far above the gate.
    const events = arm(40);
    const story = createMemo(() => sleep(100, "story"), { name: "story" });
    const author = createMemo(
      () => {
        story();
        return Promise.resolve("author-cached"); // settled cache hit
      },
      { name: "author" }
    );
    let landed: unknown;
    createRoot(() =>
      createEffect(
        () => author(),
        v => {
          landed = v;
        },
        { name: "page" }
      )
    );
    flush();
    await until(() => landed === "author-cached", "the cached author landing");
    await wait(10); // one extra settle turn: a late advisory would fire here
    flush();

    expect(events).toHaveLength(0);
  });

  it("first-seen identity absolves a promise the graph already knew", async () => {
    const events = arm();
    // The same in-flight promise is visible to the system early (a watcher
    // memo pulls it), then a story-dependent memo returns it after story
    // lands. Its origin predates story's landing: no chain.
    const shared = sleep(30, "shared");
    const watcher = createMemo(() => shared, { name: "watcher" });
    createRoot(() =>
      createEffect(
        () => watcher(),
        () => {},
        { name: "early-observer" }
      )
    );
    flush(); // shared's first sighting registers its origin now

    const story = createMemo(() => sleep(15, "story"), { name: "story" });
    const dependent = createMemo(
      () => {
        story();
        return shared;
      },
      { name: "dependent" }
    );
    let landed: unknown;
    createRoot(() =>
      createEffect(
        () => dependent(),
        v => {
          landed = v;
        },
        { name: "page" }
      )
    );
    flush();
    await until(() => landed === "shared", "the shared promise landing");
    await wait(10); // one extra settle turn: a late advisory would fire here
    flush();

    expect(events).toHaveLength(0);
  });

  it("independently-pulled siblings never chain to each other", async () => {
    // Each side has its own reader (the compiled-JSX shape: one render effect
    // per binding), so both fetches start in the same flush when root lands.
    const events = arm();
    const root = createMemo(() => sleep(12, "root"), { name: "root" });
    const left = createMemo(() => sleep(12, root() + "-L"), { name: "left" });
    const right = createMemo(() => sleep(12, root() + "-R"), { name: "right" });
    createRoot(() => {
      createEffect(
        () => left(),
        () => {},
        { name: "left-binding" }
      );
      createEffect(
        () => right(),
        () => {},
        { name: "right-binding" }
      );
    });
    flush();
    await until(() => events.length >= 2, "both sibling advisories");

    // Each dependent chains to root (two depth-2 advisories) but no chain
    // contains both siblings — they ran in parallel.
    expect(events.length).toBeGreaterThanOrEqual(2);
    for (const e of events) {
      const names = chainNames(e);
      expect(names[0]).toBe("root");
      expect(names).toHaveLength(2);
      expect(names).not.toEqual(expect.arrayContaining(["left", "right"]));
    }
  });

  it("FINDING: one scope reading two async sources serializes them — and is caught", async () => {
    // The diamond read from a SINGLE scope is not parallel: `[left(), right()]`
    // throws not-ready at left(), so right() is never pulled — its lazy first
    // compute (and fetch) starts only after left lands. The detector's
    // create-run frame walk attributes right's flight through the page
    // effect's cause (left's landing): a real, provable 3-deep waterfall.
    const events = arm();
    const root = createMemo(() => sleep(12, "root"), { name: "root" });
    const left = createMemo(() => sleep(12, root() + "-L"), { name: "left" });
    const right = createMemo(() => sleep(12, root() + "-R"), { name: "right" });
    createRoot(() =>
      createEffect(
        () => [left(), right()],
        () => {},
        { name: "page" }
      )
    );
    flush();
    await until(() => events.some(e => e.severity === "warn"), "the serialized-diamond warn");

    const worst = events.find(e => e.severity === "warn");
    expect(worst).toBeDefined();
    expect(chainNames(worst!)).toEqual(["root", "left", "right"]);
  });

  it("chains flights started in CREATE runs nested under a caused recompute", async () => {
    // Boundary-reveal shape: a node born inside a recompute that an async
    // landing caused (child content materializing after the parent resolves)
    // inherits the parent frame's causality via the frame-stack walk.
    const events = arm();
    const gate = createMemo(() => sleep(12, "gate"), { name: "gate" });
    const layout = createMemo(
      () => {
        const g = gate(); // NotReady until gate lands
        const child = createMemo(() => sleep(12, g + "-child"), { name: "child-data" });
        return child();
      },
      { name: "layout" }
    );
    createRoot(() =>
      createEffect(
        () => layout(),
        () => {},
        { name: "page" }
      )
    );
    flush();
    await until(
      () => events.some(e => e.nodeName === "child-data"),
      "the nested create-run advisory"
    );

    const childEvent = events.find(e => e.nodeName === "child-data");
    expect(childEvent).toBeDefined();
    expect(chainNames(childEvent!)).toEqual(["gate", "child-data"]);
  });
});
