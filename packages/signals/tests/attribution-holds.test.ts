/**
 * Transition holds and the SILENT_HOLD verdict.
 *
 * Claim under test: when a write lands on async work the runtime holds it
 * (correctly) until the async settles; the engine records every such hold
 * that staged a root write, and calls it SILENT when the graph provably
 * rendered no acknowledgment — no isPending()/latest() reader anywhere
 * downstream of the held writes or their blockers, no optimistic value, no
 * affects() mark, and no effect ran inside the parked flushes. Each of those
 * affordances individually clears the verdict; initial loads and bare
 * refreshes (no root write) are never judged.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  action,
  createMemo,
  createOptimistic,
  createRenderEffect,
  createRoot,
  createSignal,
  DEV,
  flush,
  isPending,
  latest
} from "../src/index.js";
import type { DiagnosticEvent } from "../src/core/dev.js";

afterEach(() => {
  DEV!.attribution.disable();
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

function arm(holds: { infoMs: number; warnMs: number } | false = { infoMs: 0, warnMs: 0 }) {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  DEV!.attribution.enable({
    log: false,
    hotRuns: false,
    hotTime: false,
    waterfalls: false,
    holds
  });
  const events: DiagnosticEvent[] = [];
  DEV!.diagnostics.subscribe(e => {
    if (e.code === "SILENT_HOLD") events.push(e);
  });
  return { events, warn };
}

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
  return {
    page,
    setPage,
    posts,
    shown,
    resolve: (v: string) => resolve!(v),
    reading(read: () => unknown = posts) {
      createRenderEffect(
        read,
        v => {
          shown.push(String(v));
        },
        { name: "feed" }
      );
    }
  };
}

describe("SILENT_HOLD", () => {
  it("names the held write, the blocker, and the missing affordances", async () => {
    const { events, warn } = arm();
    const feed = pagedFeed();
    createRoot(() => feed.reading());
    flush();
    feed.resolve("a");
    await until(() => feed.shown.includes("a-p1"), "initial load");

    feed.setPage(2);
    flush();
    expect(feed.shown).toEqual(["a-p1"]); // held: nothing painted
    await wait(10);
    feed.resolve("b");
    await until(() => feed.shown.includes("b-p2"), "the held page to land");

    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e.severity).toBe("warn");
    expect(e.kind).toBe("responsiveness");
    expect(e.nodeName).toBe("page");
    expect(e.data).toMatchObject({ heldWrites: ["page"], blockers: ["posts"], action: false });
    expect(e.message).toContain(`writes to "page" (1 → 2) were held`);
    expect(e.message).toContain(`waiting on "posts"`);
    expect(e.message).toContain("isPending(() => posts())");
    expect(e.message).toContain("latest(page)");
    expect(warn).toHaveBeenCalledTimes(1);

    const holds = DEV!.attribution.holds();
    expect(holds).toHaveLength(1);
    expect(holds[0]).toMatchObject({
      heldWrites: [{ name: "page", prev: "1", value: "2" }],
      blockers: ["posts"],
      acknowledgedBy: [],
      paintedDuringHold: 0,
      action: false
    });
    expect(holds[0].holdMs).toBeGreaterThanOrEqual(10);
    expect(holds[0].flushes).toBeGreaterThanOrEqual(1);
  });

  it("never judges a hold that staged no root write (initial load)", async () => {
    const { events } = arm();
    const feed = pagedFeed();
    createRoot(() => feed.reading());
    flush();
    await wait(10);
    feed.resolve("a");
    await until(() => feed.shown.includes("a-p1"), "initial load");
    expect(events).toHaveLength(0);
    expect(DEV!.attribution.holds()).toHaveLength(0);
  });

  it("is cleared by an isPending() reader on the blocker", async () => {
    const { events } = arm();
    const feed = pagedFeed();
    const busy: boolean[] = [];
    createRoot(() => {
      feed.reading();
      createRenderEffect(
        () => isPending(() => feed.posts()),
        v => {
          busy.push(v);
        },
        { name: "spinner" }
      );
    });
    flush();
    feed.resolve("a");
    await until(() => feed.shown.includes("a-p1"), "initial load");

    feed.setPage(2);
    flush();
    expect(busy.at(-1)).toBe(true); // the screen acknowledged the wait
    await wait(10);
    feed.resolve("b");
    await until(() => feed.shown.includes("b-p2"), "the held page to land");

    expect(events).toHaveLength(0);
    const [hold] = DEV!.attribution.holds();
    expect(hold.acknowledgedBy).toContain("isPending:posts");
    expect(hold.paintedDuringHold).toBeGreaterThan(0); // the spinner effect ran while parked
  });

  it("is cleared by an isPending() reader on a memo DERIVED from the blocker", async () => {
    const { events } = arm();
    const feed = pagedFeed();
    createRoot(() => {
      const upper = createMemo(() => feed.posts().toUpperCase(), { name: "upper" });
      feed.reading(upper);
      createRenderEffect(
        () => isPending(() => upper()),
        () => {},
        { name: "spinner" }
      );
    });
    flush();
    feed.resolve("a");
    await until(() => feed.shown.includes("A-P1"), "initial load");

    feed.setPage(2);
    flush();
    await wait(10);
    feed.resolve("b");
    await until(() => feed.shown.includes("B-P2"), "the held page to land");

    expect(events).toHaveLength(0);
    expect(DEV!.attribution.holds()[0].acknowledgedBy).toContain("isPending:upper");
  });

  it("is cleared by a latest() reader on the held write", async () => {
    const { events } = arm();
    const feed = pagedFeed();
    const header: number[] = [];
    createRoot(() => {
      feed.reading();
      createRenderEffect(
        () => latest(feed.page),
        v => {
          header.push(v);
        },
        { name: "pageHeader" }
      );
    });
    flush();
    feed.resolve("a");
    await until(() => feed.shown.includes("a-p1"), "initial load");

    feed.setPage(2);
    flush();
    expect(header.at(-1)).toBe(2); // the new input showed immediately
    await wait(10);
    feed.resolve("b");
    await until(() => feed.shown.includes("b-p2"), "the held page to land");

    expect(events).toHaveLength(0);
    expect(DEV!.attribution.holds()[0].acknowledgedBy).toContain("latest:page");
  });

  it("is cleared by an optimistic value written alongside", async () => {
    const { events } = arm();
    const feed = pagedFeed();
    const [saving, setSaving] = createOptimistic(false, { name: "saving" });
    const seen: boolean[] = [];
    createRoot(() => {
      feed.reading();
      createRenderEffect(saving, v => {
        seen.push(v);
      });
    });
    flush();
    feed.resolve("a");
    await until(() => feed.shown.includes("a-p1"), "initial load");

    feed.setPage(2);
    setSaving(true);
    flush();
    expect(seen.at(-1)).toBe(true);
    await wait(10);
    feed.resolve("b");
    await until(() => feed.shown.includes("b-p2"), "the held page to land");

    expect(events).toHaveLength(0);
    expect(DEV!.attribution.holds()[0].acknowledgedBy).toContain("optimistic:saving");
  });

  it("tiers by duration: below infoMs nothing, between info and warn an advisory", async () => {
    const { events, warn } = arm({ infoMs: 20, warnMs: 10_000 });
    const feed = pagedFeed();
    createRoot(() => feed.reading());
    flush();
    feed.resolve("a");
    await until(() => feed.shown.includes("a-p1"), "initial load");

    // Fast round-trip: recorded as a hold, no verdict.
    feed.setPage(2);
    flush();
    feed.resolve("b");
    await until(() => feed.shown.includes("b-p2"), "fast page");
    expect(DEV!.attribution.holds()).toHaveLength(1);
    expect(events).toHaveLength(0);

    // Slow round-trip: advisory only — structured event, no console.
    feed.setPage(3);
    flush();
    await wait(40);
    feed.resolve("c");
    await until(() => feed.shown.includes("c-p3"), "slow page");
    expect(DEV!.attribution.holds()).toHaveLength(2);
    expect(events).toHaveLength(1);
    expect(events[0].severity).toBe("info");
    expect(warn).not.toHaveBeenCalled();
  });

  it("holds: false disables recording and verdicts", async () => {
    const { events } = arm(false);
    const feed = pagedFeed();
    createRoot(() => feed.reading());
    flush();
    feed.resolve("a");
    await until(() => feed.shown.includes("a-p1"), "initial load");
    feed.setPage(2);
    flush();
    await wait(10);
    feed.resolve("b");
    await until(() => feed.shown.includes("b-p2"), "the held page to land");
    expect(events).toHaveLength(0);
    expect(DEV!.attribution.holds()).toHaveLength(0);
  });

  it("reports an action's plain writes with the optimistic repair", async () => {
    const { events } = arm();
    const [name, setName] = createSignal("draft", { name: "title" });
    const shown: string[] = [];
    createRoot(() =>
      createRenderEffect(name, v => {
        shown.push(v);
      })
    );
    flush();
    let release!: () => void;
    const save = action(function* () {
      setName("saved"); // plain transactional write: held until the action settles
      yield new Promise<void>(r => (release = r));
    });
    const done = save();
    flush();
    expect(shown).toEqual(["draft"]);
    await wait(10);
    release();
    await done;
    await until(() => shown.includes("saved"), "the action to commit");

    expect(events).toHaveLength(1);
    expect(events[0].data).toMatchObject({ heldWrites: ["title"], action: true });
    expect(events[0].message).toContain("an action held");
    expect(events[0].message).toContain("createOptimistic");
    expect(DEV!.attribution.holds()[0]).toMatchObject({
      action: true,
      heldWrites: [{ name: "title", prev: '"draft"', value: '"saved"' }]
    });
  });

  it("an action's optimistic write clears the verdict", async () => {
    const { events } = arm();
    const [name, setName] = createSignal("draft", { name: "title" });
    const [pendingName, setPendingName] = createOptimistic("", { name: "pendingTitle" });
    createRoot(() => {
      createRenderEffect(name, () => {});
      createRenderEffect(pendingName, () => {});
    });
    flush();
    let release!: () => void;
    const save = action(function* () {
      setPendingName("saved…");
      setName("saved");
      yield new Promise<void>(r => (release = r));
    });
    const done = save();
    flush();
    await wait(10);
    release();
    await done;
    await until(() => name() === "saved", "the action to commit");

    expect(events).toHaveLength(0);
    expect(DEV!.attribution.holds()[0].acknowledgedBy).toContain("optimistic:pendingTitle");
  });
});
