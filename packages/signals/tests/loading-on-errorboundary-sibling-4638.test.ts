/**
 * #4638 — two sibling `<Loading on={sel()}>` boundaries; one reads its async
 * memo through an error boundary created in the component body (outside the
 * Loading, as a value-level catch), the other reads a plain async memo keyed
 * by the same signal. After the key changes, both re-arm and both fallbacks
 * show now (F-4, F-5, D-14, D-15): the error boundary is a derivation, not a
 * render effect, and its only reader is under the first Loading, so nothing
 * outside either boundary reads the flights (D-16 does not apply).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  createErrorBoundary,
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  untrack
} from "../src/index.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** A DOM-like part: a render effect under the owner writes its text. */
function part(read: () => string) {
  const el = { text: "-" };
  createRenderEffect(read, v => {
    el.text = v;
  });
  return el;
}

function page(caught: boolean, sibling: boolean, header = false) {
  const asks: { key: string; res: (v: any) => void }[] = [];
  const ask = (key: string) => new Promise<any>(res => asks.push({ key, res }));
  const view: {
    header: string;
    detail: { text: string } | null;
    comments: { text: string } | null;
  } = { header: "-", detail: null, comments: null };
  const [sel, setSel] = createSignal(3);
  let dispose!: () => void;
  createRoot(d => {
    dispose = d;
    const detail = createMemo(() => ask(`detail:${sel()}`), { name: "detail" });
    const shown = caught
      ? untrack(() =>
          createErrorBoundary(
            () => detail(),
            () => null
          )
        )
      : detail;
    if (header)
      createRenderEffect(
        () => (shown() as any)?.title,
        v => {
          view.header = String(v);
        }
      );
    const comments = createMemo(() => ask(`comments:${sel()}`), { name: "comments" });
    const a = untrack(() =>
      createLoadingBoundary(
        () => part(() => (shown() as any)?.title),
        () => part(() => `loading #${sel()}`),
        { on: () => sel() }
      )
    );
    createRenderEffect(a, v => {
      view.detail = v;
    });
    if (sibling) {
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
    }
  });
  const settle = async (key: string, v: any) => {
    const i = asks.findIndex(a => a.key === key);
    if (i >= 0) asks.splice(i, 1)[0].res(v);
    for (let k = 0; k < 4; k++) {
      await vi.advanceTimersByTimeAsync(0);
      flush();
    }
  };
  const t = (el: { text: string } | null) => (el ? el.text : "-");
  const screen = () =>
    (header ? `${view.header} / ` : "") +
    (sibling ? `${t(view.detail)} | ${t(view.comments)}` : t(view.detail));
  return { setSel, settle, screen, dispose };
}

describe("#4638 sibling Loading on through an error boundary", () => {
  for (const caught of [false, true])
    for (const sibling of [false, true])
      test(`${caught ? "error boundary" : "plain"}${sibling ? " + sibling" : ""}: both fallbacks show now`, async () => {
        const p = page(caught, sibling);
        flush();
        await p.settle("detail:3", { title: "Crash" });
        await p.settle("comments:3", [1]);
        expect(p.screen()).toBe(sibling ? "Crash | comments 1" : "Crash");
        p.setSel(1);
        flush();
        await p.settle("", null);
        expect(p.screen()).toBe(sibling ? "loading #1 | loading comments" : "loading #1");
        await p.settle("detail:1", { title: "One" });
        expect(p.screen()).toBe(sibling ? "One | loading comments" : "One");
        await p.settle("comments:1", [1, 2]);
        expect(p.screen()).toBe(sibling ? "One | comments 2" : "One");
        p.dispose();
      });

  // D-16: the error boundary also read by a render effect outside the
  // Loading (a header) is an outside reader of the flight the change
  // started — the frame waits on it, and the re-arms' fallbacks are never
  // seen; the frame lands with `detail`.
  test("error boundary also read outside (D-16): the frame holds until detail lands", async () => {
    const p = page(true, true, true);
    flush();
    await p.settle("detail:3", { title: "Crash" });
    await p.settle("comments:3", [1]);
    expect(p.screen()).toBe("Crash / Crash | comments 1");
    p.setSel(1);
    flush();
    await p.settle("", null);
    expect(p.screen()).toBe("Crash / Crash | comments 1");
    await p.settle("detail:1", { title: "One" });
    expect(p.screen()).toBe("One / One | loading comments");
    await p.settle("comments:1", [1, 2]);
    expect(p.screen()).toBe("One / One | comments 2");
    p.dispose();
  });
});
