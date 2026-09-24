/**
 * The feedback-table facts as findings while they happen.
 *
 * `feedback()` already counts abandoned flights per source, fallback flashes
 * per boundary and holds per interaction; these are the same facts emitted on
 * the diagnostics channel at a threshold, so a consumer that never imports
 * the fold still hears them: ABANDONED_FLIGHTS (warn, once per window per
 * source), FALLBACK_FLASH (info, per flash), STACKED_HOLDS (warn, per hold).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { attribution } from "../src/attribution.js";
import type { AttributionOptions } from "../src/attribution.js";
import {
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  OBSERVE
} from "../src/index.js";
import type { DiagnosticCode, DiagnosticEvent } from "../src/core/dev.js";

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

function arm(code: DiagnosticCode, opts: AttributionOptions = {}) {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  attribution.enable({
    log: false,
    hotRuns: false,
    hotTime: false,
    waterfalls: false,
    holds: { infoMs: 60_000, warnMs: 60_000 },
    longHolds: { infoMs: 60_000, warnMs: 60_000 },
    ...opts
  });
  const findings: DiagnosticEvent[] = [];
  OBSERVE!.diagnostics.subscribe(e => {
    if (e.code === code) findings.push(e);
  });
  return { findings, warn };
}

const CLICK = { type: "click", target: 'button#next "Next →"' };

/** A controllable async source; `read: false` leaves it to a boundary to read. */
function pagedFeed(name = "posts", read = true) {
  const [page, setPage] = createSignal(1, { name: `${name}Page` });
  let resolve: ((v: string) => void) | null = null;
  const posts = createMemo(
    () => {
      const p = page();
      return new Promise<string>(r => (resolve = v => r(`${v}-p${p}`)));
    },
    { name }
  );
  const shown: string[] = [];
  if (read)
    createRoot(() =>
      createRenderEffect(
        posts,
        v => {
          shown.push(String(v));
        },
        { name: `${name}Feed` }
      )
    );
  return { setPage, posts, shown, resolve: (v: string) => resolve!(v) };
}

describe("ABANDONED_FLIGHTS", () => {
  it("fires once when a source abandons `count` flights within the window", async () => {
    const { findings, warn } = arm("ABANDONED_FLIGHTS", {
      abandonedFlights: { count: 3, windowMs: 1000 }
    });
    const feed = pagedFeed();
    flush();
    feed.resolve("a");
    await until(() => feed.shown.includes("a-p1"), "initial load");
    // Four keystrokes, each re-asking before the previous answer: three abandoned.
    for (const p of [2, 3, 4, 5]) {
      OBSERVE!.attribution.withInteraction({ type: "input", target: "input#search" }, () =>
        feed.setPage(p)
      );
      flush();
    }
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: "ABANDONED_FLIGHTS",
      kind: "responsiveness",
      severity: "warn",
      nodeName: "posts",
      data: {
        source: "posts",
        abandoned: 3,
        windowMs: 1000,
        interaction: { type: "input", target: "input#search" }
      }
    });
    expect(findings[0].message).toContain('"posts" abandoned 3 flights');
    expect(findings[0].message).toContain("debounced");
    expect(warn).toHaveBeenCalled();
    // A fifth re-ask inside the same window does not warn again.
    feed.setPage(6);
    flush();
    expect(findings).toHaveLength(1);
    feed.resolve("z");
    await until(() => feed.shown.includes("z-p6"), "the last flight to land");
  });

  it("two abandons are below the default count; `false` disables", async () => {
    const { findings } = arm("ABANDONED_FLIGHTS");
    const feed = pagedFeed();
    flush();
    feed.resolve("a");
    await until(() => feed.shown.includes("a-p1"), "initial load");
    feed.setPage(2);
    flush();
    feed.setPage(3);
    flush();
    expect(findings).toHaveLength(0);
    feed.resolve("c");
    await until(() => feed.shown.includes("c-p3"), "landing");
    attribution.disable();

    const off = arm("ABANDONED_FLIGHTS", { abandonedFlights: false });
    const other = pagedFeed("other");
    flush();
    other.resolve("a");
    await until(() => other.shown.includes("a-p1"), "other initial load");
    for (const p of [2, 3, 4, 5]) {
      other.setPage(p);
      flush();
    }
    expect(off.findings).toHaveLength(0);
    other.resolve("z");
    await until(() => other.shown.includes("z-p5"), "other landing");
  });
});

describe("FALLBACK_FLASH", () => {
  function boundaryOver(feed: ReturnType<typeof pagedFeed>) {
    const shown: string[] = [];
    createRoot(() => {
      const view = createLoadingBoundary(
        () => feed.posts(),
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
    return shown;
  }

  it("a fallback shown under the flash window is a finding, located at the boundary", async () => {
    const { findings } = arm("FALLBACK_FLASH");
    const feed = pagedFeed("posts", false);
    const shown = boundaryOver(feed);
    expect(shown).toEqual(["loading…"]);
    await wait(20);
    feed.resolve("a");
    await until(() => shown.includes("a-p1"), "content");
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: "FALLBACK_FLASH",
      kind: "responsiveness",
      severity: "info"
    });
    const data = findings[0].data as { shownMs: number };
    expect(data.shownMs).toBeGreaterThanOrEqual(15);
    expect(data.shownMs).toBeLessThan(150);
    expect(findings[0].message).toContain("appeared and vanished");
  });

  it("a fallback that stayed past the window is not a flash; `fallbackFlashes: false` disables", async () => {
    const { findings } = arm("FALLBACK_FLASH");
    const feed = pagedFeed("posts", false);
    const shown = boundaryOver(feed);
    await wait(170);
    feed.resolve("a");
    await until(() => shown.includes("a-p1"), "content");
    expect(findings).toHaveLength(0);
    attribution.disable();

    const off = arm("FALLBACK_FLASH", { fallbackFlashes: false });
    const other = pagedFeed("other", false);
    const otherShown = boundaryOver(other);
    await wait(10);
    other.resolve("a");
    await until(() => otherShown.includes("a-p1"), "other content");
    expect(off.findings).toHaveLength(0);
  });
});

describe("STACKED_HOLDS", () => {
  it("fires when `count` interactions wait in one hold, naming the blocker and the pile", async () => {
    const { findings, warn } = arm("STACKED_HOLDS", { stackedHolds: { count: 3 } });
    const feed = pagedFeed();
    flush();
    feed.resolve("a");
    await until(() => feed.shown.includes("a-p1"), "initial load");
    // Three clicks while the first answer is still in the air: one hold, three waiters.
    for (const p of [2, 3, 4]) {
      OBSERVE!.attribution.withInteraction(CLICK, () => feed.setPage(p));
      flush();
    }
    expect(feed.shown).toEqual(["a-p1"]);
    feed.resolve("d");
    await until(() => feed.shown.includes("d-p4"), "the held page to land");
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: "STACKED_HOLDS",
      kind: "responsiveness",
      severity: "warn",
      nodeName: "postsPage",
      data: { interactions: 3, blockers: ["posts"] }
    });
    expect(findings[0].message).toContain("3 interactions queued behind one hold");
    expect(findings[0].message).toContain("isPending()");
    expect(warn).toHaveBeenCalled();
  });

  it("two waiters are below the default; `false` disables", async () => {
    const { findings } = arm("STACKED_HOLDS");
    const feed = pagedFeed();
    flush();
    feed.resolve("a");
    await until(() => feed.shown.includes("a-p1"), "initial load");
    for (const p of [2, 3]) {
      OBSERVE!.attribution.withInteraction(CLICK, () => feed.setPage(p));
      flush();
    }
    feed.resolve("c");
    await until(() => feed.shown.includes("c-p3"), "landing");
    expect(findings).toHaveLength(0);
    attribution.disable();

    const off = arm("STACKED_HOLDS", { stackedHolds: false });
    const other = pagedFeed("other");
    flush();
    other.resolve("a");
    await until(() => other.shown.includes("a-p1"), "other initial load");
    for (const p of [2, 3, 4]) {
      OBSERVE!.attribution.withInteraction(CLICK, () => other.setPage(p));
      flush();
    }
    other.resolve("d");
    await until(() => other.shown.includes("d-p4"), "other landing");
    expect(off.findings).toHaveLength(0);
  });
});
