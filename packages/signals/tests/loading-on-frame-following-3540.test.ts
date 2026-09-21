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
 *     waits for it, so no fallback ever shows — by design; DEV warns
 *     LOADING_ON_OUTSIDE_HOLD once per re-arm;
 *  4. `on={latest(id)}`: the display-ahead read — the fallback shows now,
 *     beside the held frame, and no diagnostic (the user's explicit choice).
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

describe("3. an outside hold on the SAME source: the frame waits, no fallback — by design; DEV warns", () => {
  for (const write of ["plain", "action"] as Write[]) {
    test(`${write} write: comments read outside the boundary too — [A] → [B + comments], LOADING_ON_OUTSIDE_HOLD once`, async () => {
      const d = captureWarnings();
      const t = page({ productMs: 50, commentsMs: 100, on: "id", outsideComments: true });
      await t.settle();
      expect(t.frames).toEqual(["product 1 + comments 1 + comments 1"]);

      // The re-arm releases the boundary's reader of comments, but the
      // outside reader keeps the frame waiting on the same flight: the
      // fallback swap lands with a frame that, by then, has the content.
      const release = t.navigate(write);
      expect(d.codes()).toEqual(["LOADING_ON_OUTSIDE_HOLD"]);
      const event = d.stop()[0];
      expect(event.severity).toBe("warn");
      expect(event.kind).toBe("async");
      expect(event.data).toEqual({ source: "comments" });
      expect(event.message).toContain("`comments` is also read outside it");
      expect(event.message).toContain("latest()");
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
      t.dispose();
    });
  }
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
