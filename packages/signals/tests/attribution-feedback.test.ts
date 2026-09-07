/**
 * feedback(): what the user waited on, as ranked tables.
 *
 * Claim under test: feedback() is a pure fold over the records the engine
 * already keeps — holds() and the interaction on each re-run — with no
 * measurement of its own. `sources` ranks async sources by the silent time
 * writes spent held behind them and shows which affordances answered and how
 * often, so a source acknowledged on one screen and silent on another reads as
 * exactly that; `interactions` ranks user events by what they cost — re-run
 * work beside time held. Every hold counts, at any duration.
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

function arm() {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  // Verdict thresholds far away: feedback() must count holds SILENT_HOLD never judged.
  DEV!.attribution.enable({
    log: false,
    hotRuns: false,
    hotTime: false,
    waterfalls: false,
    holds: { infoMs: 60_000, warnMs: 60_000 }
  });
}

const CLICK = { type: "click", target: 'button#next "Next →"' };
const KEY = { type: "keydown", target: 'input#search ""' };

/** A controllable async source: `posts` re-fetches whenever `page` changes. */
function pagedFeed(name = "posts") {
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
        { name: `${name}Feed` }
      );
    },
    async load(v: string) {
      resolve!(v);
      await until(() => shown.some(s => s.startsWith(v)), `${name} to show ${v}`);
    }
  };
}

describe("feedback()", () => {
  it("starts empty and counts every hold, not only the ones past the verdict thresholds", async () => {
    arm();
    expect(DEV!.attribution.feedback()).toEqual({ sources: [], interactions: [] });
    const feed = pagedFeed();
    createRoot(() => feed.reading());
    flush();
    await feed.load("a"); // initial load: no root write, never a hold

    expect(DEV!.attribution.feedback().sources).toEqual([]);
    feed.setPage(2);
    flush();
    await feed.load("b");

    const { sources } = DEV!.attribution.feedback();
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      sources: ["posts"],
      holds: 1,
      silent: 1,
      latestOnly: 0,
      acknowledgedBy: [],
      interactions: [],
      writes: ["postsPage"],
      actions: 0
    });
    expect(sources[0].heldMs).toBeGreaterThan(0);
    expect(sources[0].silentMs).toBe(sources[0].heldMs);
    expect(sources[0].worstMs).toBe(sources[0].heldMs);
  });

  it("shows a source that is sometimes acknowledged as exactly that", async () => {
    arm();
    const feed = pagedFeed();
    const [showBusy, setShowBusy] = createSignal(false, { name: "showBusy" });
    const busy: boolean[] = [];
    createRoot(() => {
      feed.reading();
      // A busy indicator that only exists on one "screen".
      createRenderEffect(
        () => (showBusy() ? isPending(() => feed.posts()) : null),
        v => {
          if (v !== null) busy.push(v);
        },
        { name: "spinner" }
      );
    });
    flush();
    await feed.load("a");

    // Screen 1: no indicator mounted — silent.
    feed.setPage(2);
    flush();
    await feed.load("b");
    // Screen 2: indicator mounted — acknowledged by isPending.
    setShowBusy(true);
    flush();
    feed.setPage(3);
    flush();
    await feed.load("c");
    feed.setPage(4);
    flush();
    await feed.load("d");

    const [row] = DEV!.attribution.feedback().sources;
    expect(row).toMatchObject({ sources: ["posts"], holds: 3, silent: 1 });
    expect(row.acknowledgedBy).toEqual([{ by: "isPending:posts", holds: 2 }]);
    expect(row.silentMs).toBeLessThan(row.heldMs);
  });

  it("counts a hold answered only by latest() separately — the input showed, nothing said loading", async () => {
    arm();
    const feed = pagedFeed();
    const pages: number[] = [];
    createRoot(() => {
      feed.reading();
      createRenderEffect(
        () => latest(feed.page),
        p => {
          pages.push(p);
        },
        { name: "pageLabel" }
      );
    });
    flush();
    await feed.load("a");
    feed.setPage(2);
    flush();
    await feed.load("b");

    const [row] = DEV!.attribution.feedback().sources;
    expect(row).toMatchObject({ holds: 1, silent: 0, latestOnly: 1 });
    expect(row.acknowledgedBy).toEqual([{ by: "latest:postsPage", holds: 1 }]);
  });

  it("keys the interactions that were held, on the source row and in the interactions table", async () => {
    arm();
    const feed = pagedFeed();
    createRoot(() => feed.reading());
    flush();
    await feed.load("a");

    DEV!.attribution.withInteraction({ ...CLICK, at: performance.now() - 40 }, () =>
      feed.setPage(2)
    );
    flush();
    await feed.load("b");
    DEV!.attribution.withInteraction({ ...CLICK, at: performance.now() }, () => feed.setPage(3));
    flush();
    await feed.load("c");
    DEV!.attribution.withInteraction({ ...KEY, at: performance.now() }, () => feed.setPage(4));
    flush();
    await feed.load("d");

    const { sources, interactions } = DEV!.attribution.feedback();
    expect(sources[0].interactions).toEqual([
      { interaction: 'click on button#next "Next →"', holds: 2 },
      { interaction: 'keydown on input#search ""', holds: 1 }
    ]);
    expect(interactions.map(i => i.interaction)).toEqual([
      'click on button#next "Next →"',
      'keydown on input#search ""'
    ]);
    const click = interactions[0];
    expect(click).toMatchObject({ dispatches: 2, holds: 2 });
    // The first click was dispatched 40ms before its write: the hold is measured from the event.
    expect(click.worstHoldMs).toBeGreaterThanOrEqual(40);
    expect(click.heldMs).toBeGreaterThanOrEqual(click.worstHoldMs);
    expect(click.silentMs).toBe(click.heldMs);
    // The feed effect's re-runs trace back to the click through the held write.
    expect(click.runs).toBeGreaterThan(0);
    expect(click.worstDispatchMs).toBeLessThanOrEqual(click.selfMs);
  });

  it("ranks interactions by what they cost — re-run work counts even when nothing was held", () => {
    arm();
    const [n, setN] = createSignal(0, { name: "n" });
    const [m, setM] = createSignal(0, { name: "m" });
    createRoot(() => {
      for (let i = 0; i < 5; i++) createRenderEffect(n, () => {}, { name: `n-reader-${i}` });
      createRenderEffect(m, () => {}, { name: "m-reader" });
    });
    flush();
    DEV!.attribution.withInteraction({ type: "input", target: "input#a" }, () => setM(1));
    flush();
    DEV!.attribution.withInteraction({ type: "click", target: "button#b" }, () => setN(1));
    flush();
    DEV!.attribution.withInteraction({ type: "click", target: "button#b" }, () => setN(2));
    flush();

    const { sources, interactions } = DEV!.attribution.feedback();
    expect(sources).toEqual([]);
    expect(interactions).toHaveLength(2);
    expect(interactions[0]).toMatchObject({
      interaction: "click on button#b",
      dispatches: 2,
      runs: 10,
      holds: 0,
      heldMs: 0,
      silentMs: 0
    });
    expect(interactions[1]).toMatchObject({
      interaction: "input on input#a",
      dispatches: 1,
      runs: 1
    });
  });

  it("groups holds by the set of sources they waited on, and counts action holds", async () => {
    arm();
    // One page signal two async sources depend on: a write to it is a single
    // hold with two blockers.
    const [page, setPage] = createSignal(1, { name: "page" });
    const resolvers: Record<string, (v: string) => void> = {};
    const source = (name: string) =>
      createMemo(
        () => {
          const p = page();
          return new Promise<string>(r => (resolvers[name] = v => r(`${v}-p${p}`)));
        },
        { name }
      );
    const posts = source("posts");
    const comments = source("comments");
    const shown: string[] = [];
    const [title, setTitle] = createSignal("draft", { name: "title" });
    const [saving, setSaving] = createOptimistic(false, { name: "saving" });
    createRoot(() => {
      createRenderEffect(
        () => `${posts()}|${comments()}`,
        v => {
          shown.push(v);
        },
        { name: "screen" }
      );
      createRenderEffect(title, () => {}, { name: "titleLabel" });
      createRenderEffect(saving, () => {}, { name: "savingLabel" });
    });
    flush();
    resolvers.posts("a");
    resolvers.comments("a");
    await until(() => shown.includes("a-p1|a-p1"), "initial load");

    setPage(2);
    flush();
    resolvers.posts("b");
    resolvers.comments("b");
    await until(() => shown.includes("b-p2|b-p2"), "both to land");

    // An action holding a plain write, acknowledged by an optimistic flag, with
    // no async source at all.
    let release!: () => void;
    const gate = new Promise<void>(r => (release = r));
    const save = action(function* () {
      setSaving(true);
      setTitle("saved");
      yield gate;
    });
    const done = save();
    flush();
    release();
    await done;
    await until(() => title() === "saved", "the action to commit");

    const { sources } = DEV!.attribution.feedback();
    const keys = sources.map(s => s.sources.join("+"));
    expect(keys).toContain("comments+posts");
    expect(keys).toContain("");
    const actionRow = sources.find(s => s.sources.length === 0)!;
    expect(actionRow).toMatchObject({ holds: 1, actions: 1, silent: 0, writes: ["title"] });
    expect(actionRow.acknowledgedBy).toEqual([{ by: "optimistic:saving", holds: 1 }]);
  });

  it("resets with the engine", async () => {
    arm();
    const feed = pagedFeed();
    createRoot(() => feed.reading());
    flush();
    await feed.load("a");
    feed.setPage(2);
    flush();
    await feed.load("b");
    expect(DEV!.attribution.feedback().sources).toHaveLength(1);
    DEV!.attribution.disable();
    arm();
    expect(DEV!.attribution.feedback()).toEqual({ sources: [], interactions: [] });
  });
});
