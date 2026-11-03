/**
 * #4639 follow-up to #4638 — an error boundary built in the component body
 * (outside `<Loading on={sel()}>`) passes its source's pending by (A6). Its
 * output is on screen only through the render effects it reaches (Vocabulary
 * "Reader": a memo counts only through the render effects that read it,
 * wherever it was created, and a pending value no render effect reaches holds
 * nothing; F-3: "where the memo was created does not matter"). Reached only
 * by content behind the re-armed fallback, it holds nothing outside it (F-4,
 * D-14): the fallback shows with the change's frame, beside the sibling's.
 *
 * - memo: a memo built outside the Loading between the output and the content;
 * - nested: an error boundary over an error boundary, both built outside;
 * - unread: an error boundary nobody reads, beside the content's plain read;
 * - header: the output also rendered outside — a reader that is the display
 *   (D-16): the frame waits for `detail`, and DEV reports
 *   LOADING_ON_OUTSIDE_HOLD. Only then: with the fallback on screen the
 *   report would be false (D-16, "the fallback can never be seen").
 * - ueff: the output also read by a user effect outside — never a reader
 *   (Vocabulary "Reader"), so it holds nothing, as a plain read of `detail`;
 * - lattice: a diamond memo lattice 2 wide × 30 deep below the output, read
 *   by nothing on screen — each node is walked once, not once per path;
 * - header-tree: a header render effect inside an error boundary built
 *   outside, the boundary's output mounted untracked — the header is the
 *   display (D-16): the frame waits and DEV reports, as `header`.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  createEffect,
  createErrorBoundary,
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  untrack,
  OBSERVE
} from "../src/index.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

type Mode = "direct" | "memo" | "nested" | "unread" | "ueff" | "lattice" | "header" | "header-tree";

function part(read: () => string) {
  const el = { text: "-" };
  createRenderEffect(read, v => {
    el.text = v;
  });
  return el;
}

function page(mode: Mode) {
  const asks: { key: string; res: (v: any) => void; rej: (e: any) => void }[] = [];
  const ask = (key: string) => new Promise<any>((res, rej) => asks.push({ key, res, rej }));
  const view: {
    header: string;
    headerEl?: { text: string };
    detail: { text: string } | null;
    comments: { text: string } | null;
  } = { header: "", detail: null, comments: null };
  const [sel, setSel] = createSignal(3);
  let dispose!: () => void;
  createRoot(d => {
    dispose = d;
    const detail = createMemo(() => ask(`detail:${sel()}`), { name: "detail" });
    const eb = (src: () => any): (() => any) =>
      untrack(() =>
        createErrorBoundary(
          () => src(),
          () => ({ title: "ERR" })
        )
      );
    let shown: () => any = mode === "unread" ? detail : eb(detail);
    if (mode === "unread") eb(detail);
    if (mode === "nested") shown = eb(shown);
    let title = () => shown()?.title as string;
    if (mode === "memo") title = createMemo(title, { name: "title" });
    if (mode === "ueff")
      createEffect(
        () => shown()?.title,
        () => {}
      );
    if (mode === "lattice") {
      let layer = [shown, shown];
      for (let i = 0; i < 30; i++) {
        const [l, r] = layer;
        layer = [createMemo(() => [l(), r()]), createMemo(() => [r(), l()])];
      }
    }
    if (mode === "header-tree") {
      const out = untrack(() =>
        createErrorBoundary(
          () => part(() => detail().title),
          () => ({ text: "ERR" })
        )
      );
      const el = untrack(out) as { text: string };
      view.headerEl = el;
    }
    if (mode === "header")
      createRenderEffect(
        () => shown()?.title,
        v => {
          view.header = `${v} / `;
        }
      );
    const comments = createMemo(() => ask(`comments:${sel()}`), { name: "comments" });
    const a = untrack(() =>
      createLoadingBoundary(
        () => part(title),
        () => part(() => `loading #${sel()}`),
        { on: () => sel() }
      )
    );
    createRenderEffect(a, v => {
      view.detail = v;
    });
    const b = untrack(() =>
      createLoadingBoundary(
        () => part(() => `comments ${(comments() as any[]).length}`),
        () => part(() => "loading comments"),
        { on: () => sel() }
      )
    );
    createRenderEffect(b, v => {
      view.comments = v;
    });
  });
  const settle = async (key: string, v?: any, reject?: boolean) => {
    const i = asks.findIndex(a => a.key === key);
    if (i >= 0) {
      const x = asks.splice(i, 1)[0];
      reject ? x.rej(new Error("boom")) : x.res(v);
    }
    for (let k = 0; k < 4; k++) {
      await vi.advanceTimersByTimeAsync(0);
      flush();
    }
  };
  const t = (el: { text: string } | null) => (el ? el.text : "-");
  const screen = () =>
    `${view.headerEl ? `${view.headerEl.text} / ` : view.header}${t(view.detail)} | ${t(view.comments)}`;
  return { setSel, settle, screen, dispose };
}

function captureWarnings() {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const capture = OBSERVE!.diagnostics.capture();
  return {
    codes: () => capture.events.map(e => e.code).filter(c => c === "LOADING_ON_OUTSIDE_HOLD"),
    stop: () => capture.stop()
  };
}

describe("#4639 an error boundary output reached only behind fallbacks holds nothing", () => {
  for (const mode of ["direct", "memo", "nested", "unread", "ueff", "lattice"] as Mode[])
    for (const reject of mode === "unread" || mode === "lattice" ? [false] : [false, true])
      test(`${mode}${reject ? ", detail rejects" : ""}: both fallbacks show now, no LOADING_ON_OUTSIDE_HOLD`, async () => {
        const d = captureWarnings();
        const p = page(mode);
        flush();
        await p.settle("detail:3", { title: "Crash" });
        await p.settle("comments:3", [1]);
        expect(p.screen()).toBe("Crash | comments 1");
        p.setSel(1);
        flush();
        await p.settle("");
        expect(p.screen()).toBe("loading #1 | loading comments");
        await p.settle("detail:1", { title: "One" }, reject);
        const shown = reject ? "ERR" : "One";
        expect(p.screen()).toBe(`${shown} | loading comments`);
        await p.settle("comments:1", [1, 2]);
        expect(p.screen()).toBe(`${shown} | comments 2`);
        expect(d.codes()).toEqual([]);
        d.stop();
        p.dispose();
      });

  for (const mode of ["header", "header-tree"] as Mode[])
    test(`${mode} (D-16): the output rendered outside holds the frame; LOADING_ON_OUTSIDE_HOLD once`, async () => {
      const d = captureWarnings();
      const p = page(mode);
      flush();
      await p.settle("detail:3", { title: "Crash" });
      await p.settle("comments:3", [1]);
      expect(p.screen()).toBe("Crash / Crash | comments 1");
      p.setSel(1);
      flush();
      await p.settle("");
      expect(p.screen()).toBe("Crash / Crash | comments 1");
      expect(d.codes()).toEqual(["LOADING_ON_OUTSIDE_HOLD"]);
      await p.settle("detail:1", { title: "One" });
      expect(p.screen()).toBe("One / One | loading comments");
      await p.settle("comments:1", [1, 2]);
      expect(p.screen()).toBe("One / One | comments 2");
      d.stop();
      p.dispose();
    });
});
