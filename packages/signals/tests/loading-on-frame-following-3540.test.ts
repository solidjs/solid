/**
 * #3540 — Loading `on` follows the frame.
 *
 * A dependency of `on` changes: the boundary stops waiting on its current
 * content NOW (the frame no longer waits for it), and its fallback swap lands
 * WITH THE FRAME the change belongs to — not in the current frame, beside
 * content the change is still holding elsewhere. The motivating page:
 * navigate product A → B by writing `id`. The shell reads `product(id)`
 * OUTSIDE a `<Loading on={id()}>` whose content reads `comments(id)`.
 *
 *   no `on`:          [A] → [B + comments]                      (frame waits for both)
 *   `on` (rc.10):     [A] → [A + spinner] → [B + spinner] → [B + comments]
 *   `on` (this):      [A] → [B + spinner] → [B + comments]
 *   `on={latest(id)}`: the rc.10 sequence — the fallback now, by choice.
 *
 * The four requirements pinned here, each as a frame sequence observed from
 * render effects' EFFECT phase (the committed frame):
 *  1. nothing outside the boundary holds: the release lets the frame commit
 *     in the SAME pass, and the fallback lands together with the change;
 *  2. an outside hold on a DIFFERENT source (the shell): the fallback lands
 *     at that frame's commit — and if the content lands first, the swap is
 *     cleared ahead of the commit and no fallback is ever shown (nor does the
 *     new content reveal beside the old shell);
 *  3. an outside hold on the SAME source the boundary waits on: the frame
 *     waits for the very source the boundary is waiting on, so the fallback
 *     can NEVER be seen — deterministic and structural; DEV warns
 *     LOADING_ON_OUTSIDE_HOLD once per re-arm, at the change, naming the
 *     source (the only shape the diagnostic reports);
 *  4. `on={latest(id)}`: the display-ahead read — the fallback shows now,
 *     beside the held frame, and no diagnostic (the user's explicit choice).
 *  5. the write's action outlasts the data: nothing outside the boundary
 *     reads the source, but the action parks the frame past the content's
 *     landing, so the swap is cleared before it is ever displayed. That is a
 *     race (the action could as well have ended first, showing the fallback
 *     with the commit), a fallback that loses it is a legitimate outcome,
 *     and the engine cannot tell "the action awaited exactly this data" from
 *     "the action awaited something slower": NOT reported — no after-the-fact
 *     rule exists.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  action,
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  latest,
  untrack,
  OBSERVE
} from "../src/index.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const microtask = () => Promise.resolve();

type Write = "plain" | "action";
type On = "id" | "latest" | "comments";

/** The page: `product(id)` read by the shell effect outside the boundary,
 * `comments(id)` read under `<Loading on>`; optionally `comments(id)` read
 * outside too (`outsideComments`, requirement 3). Each render effect logs
 * what it applied; `frames` is the page after each `flush()` the test makes
 * (consecutive duplicates dropped) — the frame sequence. */
function page(opts: {
  productMs: number;
  commentsMs: number;
  on: On;
  outsideComments?: boolean;
  shell?: boolean;
}) {
  const [id, setId] = createSignal(1);
  const log: string[] = [];
  const view = { shell: "-", comments: "-", outside: "-" };
  const frames: string[] = [];
  let dispose!: () => void;
  createRoot(d => {
    dispose = d;
    const product = createMemo(
      async () => {
        const v = id();
        await sleep(opts.productMs);
        return `product ${v}`;
      },
      { name: "product" }
    );
    const comments = createMemo(
      async () => {
        const v = id();
        await sleep(opts.commentsMs);
        return `comments ${v}`;
      },
      { name: "comments" }
    );
    if (opts.shell !== false)
      createRenderEffect(product, v => {
        view.shell = v;
        log.push(`shell=${v}`);
      });
    if (opts.outsideComments)
      createRenderEffect(comments, v => {
        view.outside = v;
        log.push(`outside=${v}`);
      });
    const on = opts.on === "id" ? id : opts.on === "latest" ? () => latest(id) : () => comments();
    const boundary = untrack(() =>
      createLoadingBoundary(
        () => comments(),
        () => "spinner",
        { on }
      )
    );
    createRenderEffect(boundary, v => {
      view.comments = v;
      log.push(`comments=${v}`);
    });
  });
  const frame = () => {
    const f = [view.shell, view.comments, opts.outsideComments ? view.outside : null]
      .filter(v => v !== null)
      .join(" + ");
    if (frames.at(-1) !== f) frames.push(f);
    return f;
  };
  return {
    id,
    setId,
    log,
    frames,
    frame,
    dispose,
    /** Settle the mount and start the log and frames from the settled page. */
    async settle() {
      flush();
      await vi.advanceTimersByTimeAsync(Math.max(opts.productMs, opts.commentsMs) + 1);
      flush();
      log.length = 0;
      frames.length = 0;
      frame();
    },
    /** Navigate to 2: a plain write, or a write inside an action that stays
     * open until `release()` (both hold the frame while product is up). */
    navigate(write: Write) {
      let release = () => {};
      if (write === "plain") setId(2);
      else
        action(function* () {
          setId(2);
          yield new Promise<void>(r => (release = r));
        })();
      flush();
      frame();
      return async () => {
        release();
        await microtask();
        await microtask();
        flush();
        frame();
      };
    },
    async advance(ms: number) {
      await vi.advanceTimersByTimeAsync(ms);
      flush();
      frame();
    }
  };
}

function captureWarnings() {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const capture = OBSERVE!.diagnostics.capture();
  return {
    warn,
    codes: () => capture.events.map(e => e.code),
    stop: () => capture.stop()
  };
}

describe("1. nothing outside the boundary holds: fallback and change land together, now", () => {
  test("`on: id` — the release lets id's frame commit in the same pass; no intermediate frame", async () => {
    const [id, setId] = createSignal(1);
    const log: string[] = [];
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      const comments = createMemo(async () => {
        const v = id();
        await sleep(100);
        return `comments ${v}`;
      });
      const boundary = untrack(() =>
        createLoadingBoundary(
          () => comments(),
          () => "spinner",
          { on: id }
        )
      );
      // One effect over both: an intermediate frame — the fallback beside
      // the OLD id (rc.10's mainline swap, a pass ahead of the commit), or
      // the new id beside the old content — would show up as an entry.
      createRenderEffect(
        () => `${id()} ${boundary()}`,
        v => void log.push(v)
      );
    });
    flush();
    await vi.advanceTimersByTimeAsync(101);
    flush();
    expect(log).toEqual(["1 spinner", "1 comments 1"]);

    setId(2);
    flush();
    expect(log).toEqual(["1 spinner", "1 comments 1", "2 spinner"]);
    await vi.advanceTimersByTimeAsync(101);
    flush();
    expect(log).toEqual(["1 spinner", "1 comments 1", "2 spinner", "2 comments 2"]);
    dispose();
  });

  test("`on: () => comments()` — the `on` pass reading the pending source holds nothing: same as `on: id`", async () => {
    // `on` reading the async source itself: the on-node catches the pending
    // (it never registers as a reporter), so nothing outside the boundary
    // holds and the fallback lands with the write. The landing notifies `on`
    // again; a boundary already showing its fallback has nothing to re-arm.
    const d = captureWarnings();
    const t = page({ productMs: 50, commentsMs: 100, on: "comments", shell: false });
    await t.settle();
    t.navigate("plain");
    expect(t.frames).toEqual(["- + comments 1", "- + spinner"]);
    await t.advance(101);
    expect(t.frames).toEqual(["- + comments 1", "- + spinner", "- + comments 2"]);
    expect(t.log).toEqual(["comments=spinner", "comments=comments 2"]);
    expect(d.codes()).toEqual([]);
    d.stop();
    t.dispose();
  });
});

describe("2. an outside hold on a different source (the shell): the fallback lands at the commit", () => {
  for (const write of ["plain", "action"] as Write[]) {
    test(`${write} write, shell lands first: [A] → [B + spinner] → [B + comments]`, async () => {
      const d = captureWarnings();
      const t = page({ productMs: 100, commentsMs: 200, on: "id" });
      await t.settle();
      expect(t.frames).toEqual(["product 1 + comments 1"]);

      // The write: the boundary released its hold, but the shell holds the
      // frame on product. Nothing on screen changes — no spinner beside the
      // old shell.
      const release = t.navigate(write);
      expect(t.frames).toEqual(["product 1 + comments 1"]);
      if (write === "action") {
        // The action ends; product still holds.
        await release();
        expect(t.frames).toEqual(["product 1 + comments 1"]);
      }

      // Product lands: the frame commits — the new shell AND the fallback
      // (staged with id's write) together, in one pass.
      await t.advance(100);
      expect(t.frames).toEqual(["product 1 + comments 1", "product 2 + spinner"]);
      expect(t.log).toEqual(["shell=product 2", "comments=spinner"]);

      // Comments land: content reveals.
      await t.advance(100);
      expect(t.frames).toEqual([
        "product 1 + comments 1",
        "product 2 + spinner",
        "product 2 + comments 2"
      ]);
      expect(d.codes()).toEqual([]);
      d.stop();
      t.dispose();
    });

    test(`${write} write, comments land first: [A] → [B + comments] — no fallback, no tear`, async () => {
      const d = captureWarnings();
      const t = page({ productMs: 200, commentsMs: 100, on: "id" });
      await t.settle();

      const release = t.navigate(write);
      expect(t.frames).toEqual(["product 1 + comments 1"]);
      if (write === "action") await release();

      // Comments land while product still holds the frame: the new content
      // derives from the staged id and must NOT reveal beside the old shell.
      // The landing settles the boundary's collected source, so the swap is
      // cleared ahead of the commit.
      await t.advance(100);
      expect(t.frames).toEqual(["product 1 + comments 1"]);
      expect(t.log).toEqual([]);

      // Product lands: the whole new page, content included — the fallback
      // was never needed and is never shown.
      await t.advance(100);
      expect(t.frames).toEqual(["product 1 + comments 1", "product 2 + comments 2"]);
      expect(t.log).toEqual(["shell=product 2", "comments=comments 2"]);
      expect(d.codes()).toEqual([]);
      d.stop();
      t.dispose();
    });
  }
});

describe("3. an outside hold on the SAME source: the frame waits, the fallback can never be seen — DEV warns at the change", () => {
  for (const write of ["plain", "action"] as Write[]) {
    test(`${write} write: comments read outside the boundary too — [A] → [B + comments], LOADING_ON_OUTSIDE_HOLD once, naming the source`, async () => {
      const d = captureWarnings();
      const t = page({ productMs: 50, commentsMs: 100, on: "id", outsideComments: true });
      await t.settle();
      expect(t.frames).toEqual(["product 1 + comments 1 + comments 1"]);

      // The re-arm releases the boundary's reader of comments, but the
      // outside reader keeps the frame waiting on the same flight: the
      // fallback swap lands with a frame that, by then, has the content.
      // Reported at the re-arm — before anything lands — because it is
      // structural: no ordering of the flights can show this fallback.
      const release = t.navigate(write);
      expect(d.codes()).toEqual(["LOADING_ON_OUTSIDE_HOLD"]);
      const event = d.stop()[0];
      expect(event.severity).toBe("warn");
      expect(event.kind).toBe("async");
      expect(event.data).toEqual({ source: "comments" });
      expect(event.message).toContain("`comments` is also read outside it and holds the frame");
      expect(event.message).toContain("the fallback can never be seen");
      expect(event.message).toContain("Move the outside read under the boundary");
      // `latest()` in `on` is a capability, not the recommendation (#3578):
      // mentioned last, in parentheses.
      expect(event.message).toMatch(/\(Reading `latest\(\)` in `on` [^)]*\)$/);
      expect(event.message).not.toContain("isPending");
      expect(d.warn).toHaveBeenCalledTimes(1);
      if (write === "action") await release();
      expect(t.frames).toEqual(["product 1 + comments 1 + comments 1"]);

      await t.advance(50);
      expect(t.frames).toEqual(["product 1 + comments 1 + comments 1"]);
      await t.advance(50);
      expect(t.frames).toEqual([
        "product 1 + comments 1 + comments 1",
        "product 2 + comments 2 + comments 2"
      ]);
      expect(t.log).not.toContain("comments=spinner");
      // Once: nothing re-reports the re-arm when the content lands or the
      // frame commits.
      expect(d.warn).toHaveBeenCalledTimes(1);
      t.dispose();
    });
  }

  test("action write outlasting comments: reported once, at the re-arm — the landing under the open action adds nothing", async () => {
    const d = captureWarnings();
    const t = page({ productMs: 50, commentsMs: 100, on: "id", outsideComments: true });
    await t.settle();
    const release = t.navigate("action");
    expect(d.codes()).toEqual(["LOADING_ON_OUTSIDE_HOLD"]);
    // Comments land while the action still parks the frame: the same
    // re-arm, already reported at the source; no second report.
    await t.advance(100);
    expect(d.codes()).toEqual(["LOADING_ON_OUTSIDE_HOLD"]);
    await release();
    expect(t.frames).toEqual([
      "product 1 + comments 1 + comments 1",
      "product 2 + comments 2 + comments 2"
    ]);
    expect(d.warn).toHaveBeenCalledTimes(1);
    d.stop();
    t.dispose();
  });
});

describe("4. `on: () => latest(id)`: the display-ahead read shows the fallback now, beside the held frame", () => {
  for (const write of ["plain", "action"] as Write[]) {
    test(`${write} write, shell lands first: [A] → [A + spinner] → [B + spinner] → [B + comments]`, async () => {
      const d = captureWarnings();
      const t = page({ productMs: 100, commentsMs: 200, on: "latest" });
      await t.settle();

      const release = t.navigate(write);
      // The fallback now — the shell still shows A, held.
      expect(t.frames).toEqual(["product 1 + comments 1", "product 1 + spinner"]);
      if (write === "action") await release();

      await t.advance(100);
      expect(t.frames).toEqual([
        "product 1 + comments 1",
        "product 1 + spinner",
        "product 2 + spinner"
      ]);
      await t.advance(100);
      expect(t.frames).toEqual([
        "product 1 + comments 1",
        "product 1 + spinner",
        "product 2 + spinner",
        "product 2 + comments 2"
      ]);
      expect(d.codes()).toEqual([]);
      d.stop();
      t.dispose();
    });
  }

  test("comments read outside the boundary too: the fallback shows now beside the stale outside read — the user's choice, no diagnostic", async () => {
    const d = captureWarnings();
    const t = page({ productMs: 50, commentsMs: 100, on: "latest", outsideComments: true });
    await t.settle();

    t.navigate("plain");
    expect(t.frames).toEqual([
      "product 1 + comments 1 + comments 1",
      "product 1 + spinner + comments 1"
    ]);
    expect(d.codes()).toEqual([]);

    await t.advance(101);
    expect(t.frames).toEqual([
      "product 1 + comments 1 + comments 1",
      "product 1 + spinner + comments 1",
      "product 2 + comments 2 + comments 2"
    ]);
    expect(d.codes()).toEqual([]);
    d.stop();
    t.dispose();
  });
});

describe("5. the write's action outlasts the data: the fallback is never displayed — a race, not reported", () => {
  test("`on: id` written inside an action that ends after comments land: [A] → [B + comments], no diagnostic", async () => {
    // Nothing outside the boundary reads comments (no shell), so nothing is
    // reported at the re-arm. The action parks the frame; comments land
    // under it; the staged swap is cleared by the sweep that follows the
    // action's commit, before any effect phase — no spinner. Had the action
    // ended first, the fallback would have landed with the commit (the
    // held-action case in loading-on-keyed-boundary-3540.spec): the
    // fallback lost a race the developer does not control, which is a
    // legitimate outcome and not a defect. The engine cannot tell an action
    // that awaited exactly this data from one that awaited something slower,
    // so no after-the-fact rule reports it.
    const d = captureWarnings();
    const t = page({ productMs: 50, commentsMs: 100, on: "id", shell: false });
    await t.settle();
    const release = t.navigate("action");
    expect(d.codes()).toEqual([]);
    expect(t.frames).toEqual(["- + comments 1"]);

    // Comments land; the action still parks the frame: the swap can no
    // longer be seen. Nothing is reported.
    await t.advance(100);
    expect(t.frames).toEqual(["- + comments 1"]);
    expect(d.codes()).toEqual([]);

    // The action ends: the new content, no fallback ever shown, no warning.
    await release();
    expect(t.frames).toEqual(["- + comments 1", "- + comments 2"]);
    expect(t.log).toEqual(["comments=comments 2"]);
    expect(d.codes()).toEqual([]);
    expect(d.warn).not.toHaveBeenCalled();
    d.stop();
    t.dispose();
  });

  test("`on: () => latest(id)` inside the same action: the fallback showed now — no diagnostic", async () => {
    const d = captureWarnings();
    const t = page({ productMs: 50, commentsMs: 100, on: "latest", shell: false });
    await t.settle();
    const release = t.navigate("action");
    expect(t.frames).toEqual(["- + comments 1", "- + spinner"]);
    await t.advance(100);
    expect(d.codes()).toEqual([]);
    await release();
    expect(t.frames).toEqual(["- + comments 1", "- + spinner", "- + comments 2"]);
    expect(d.codes()).toEqual([]);
    d.stop();
    t.dispose();
  });

  test("plain write, nothing else holds: the fallback landed with the write — no diagnostic", async () => {
    const d = captureWarnings();
    const t = page({ productMs: 50, commentsMs: 100, on: "id", shell: false });
    await t.settle();
    t.navigate("plain");
    expect(t.frames).toEqual(["- + comments 1", "- + spinner"]);
    await t.advance(101);
    expect(t.frames).toEqual(["- + comments 1", "- + spinner", "- + comments 2"]);
    expect(d.codes()).toEqual([]);
    d.stop();
    t.dispose();
  });

  test("action write, shell holds the frame and comments land first: other data holds — a race, no diagnostic", async () => {
    // The shape of 2. (comments land first) with the action still live: the
    // fallback is not seen here either, but the frame is held by product —
    // had the shell landed first, the fallback would have shown with it.
    const d = captureWarnings();
    const t = page({ productMs: 200, commentsMs: 100, on: "id" });
    await t.settle();
    const release = t.navigate("action");
    await t.advance(100);
    expect(d.codes()).toEqual([]);
    await release();
    await t.advance(100);
    expect(t.frames).toEqual(["product 1 + comments 1", "product 2 + comments 2"]);
    expect(d.codes()).toEqual([]);
    d.stop();
    t.dispose();
  });

  test("plain write, the frame held by OTHER pending data that outlasts the content (no action): no report, content reveals at the commit", async () => {
    // The other-data hold on its own, no action anywhere: the shell's
    // `product` (a different source, read outside) holds id's frame past
    // comments' landing. The swap is cleared ahead of the commit and the
    // whole new page lands together — the fallback lost the race to the
    // content, which is by design. Nothing outside reads `comments`, so the
    // same-source rule has nothing to say, and there is no other rule.
    const d = captureWarnings();
    const t = page({ productMs: 300, commentsMs: 100, on: "id" });
    await t.settle();
    expect(t.frames).toEqual(["product 1 + comments 1"]);

    t.navigate("plain");
    expect(t.frames).toEqual(["product 1 + comments 1"]);
    expect(d.codes()).toEqual([]);

    // Comments land; product still holds the frame for another 200ms.
    await t.advance(100);
    expect(t.frames).toEqual(["product 1 + comments 1"]);
    expect(t.log).toEqual([]);
    expect(d.codes()).toEqual([]);

    // Still held, still silent — no sweep reports the cleared swap.
    await t.advance(100);
    expect(t.frames).toEqual(["product 1 + comments 1"]);
    expect(d.codes()).toEqual([]);

    // Product lands: the commit reveals the content directly.
    await t.advance(100);
    expect(t.frames).toEqual(["product 1 + comments 1", "product 2 + comments 2"]);
    expect(t.log).toEqual(["shell=product 2", "comments=comments 2"]);
    expect(t.log).not.toContain("comments=spinner");
    expect(d.codes()).toEqual([]);
    expect(d.warn).not.toHaveBeenCalled();
    d.stop();
    t.dispose();
  });
});
