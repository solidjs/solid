// #4367: a verdict memo — `<Show when={isPending(s)}>`'s condition — reads
// `true` from the verdict lane while an action holds its write to `s`. A
// write outside the action that matches the action's value ends the verdict
// (nothing differs from the held write), and the memo's mainline pass leaves
// the lane on `false`, equal to its committed value: the equality gate
// notifies nobody, and the lane seam only woke a reader that had seen the
// lane's slot when the lane's frame was not held. The action is still open,
// so the reader kept `pending` for good — beside the inline form, which reads
// `false` at that flush (D-17: a memo between `isPending` and its reader
// behaves as the direct read does). A pass outside any transaction's flush
// publishes to the screen: its readers re-derive at the seam whatever holds
// the lane's frame. (Re-pinned for #4485: the opening tick's writes net to
// the committed value, so that tick made no proposal and never shows
// `pending` (D-8); the settle after the later writes is unchanged.)
import { describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flush();
};

describe("#4367 isPending(s) after an action, with s also written outside it", () => {
  for (const memo of [false, true])
    for (const value of [false, true])
      it(`${memo ? "memo" : "inline"} verdict${value ? " beside s()" : ""}`, async () => {
        const [s, set] = createSignal(2);
        let release!: () => void;
        const act = action(function* (v: number) {
          set(v);
          yield new Promise<void>(r => (release = r));
        });
        const frames: string[] = [];
        const dispose = createRoot(dispose => {
          const pending = memo ? createMemo(() => isPending(s)) : () => isPending(s);
          createRenderEffect(
            () => (pending() ? "pending" : "F") + (value ? s() : ""),
            v => {
              frames.push(v);
            }
          );
          return dispose;
        });
        const v = (n: number) => (value ? String(n) : "");
        flush();
        act(3);
        set(2);
        await tick();
        // `set(3)` in the action and `set(2)` outside it are one tick's writes
        // to `s`, and they net to its committed value: no proposal, so `s` is
        // not held and pends nothing (D-8, #4485) — the screen stays `F`.
        // (`s` lands at 2 without the later write.)
        expect([...new Set(frames)]).toEqual([`F${v(2)}`]);
        set(3);
        flush();
        // Nothing differs from the action's write: not pending, in either form.
        expect(frames.at(-1)).toBe(`F${v(3)}`);
        release();
        await tick();
        expect(s()).toBe(3);
        expect(isPending(s)).toBe(false);
        expect(frames.at(-1)).toBe(`F${v(3)}`);
        dispose();
      });

  it("the generated variant: s=0, A(s=2), s=0, tick, s=2", async () => {
    const [s, set] = createSignal(0);
    let release!: () => void;
    const act = action(function* (v: number) {
      set(v);
      yield new Promise<void>(r => (release = r));
    });
    const frames: string[] = [];
    const dispose = createRoot(dispose => {
      const pending = createMemo(() => isPending(s));
      createRenderEffect(
        () => (pending() ? "pending" : "F"),
        v => {
          frames.push(v);
        }
      );
      return dispose;
    });
    flush();
    act(2);
    set(0);
    await tick();
    set(2);
    flush();
    release();
    await tick();
    expect(isPending(s)).toBe(false);
    // The first tick's writes net (D-8, #4485): never pending.
    expect([...new Set(frames)]).toEqual(["F"]);
    dispose();
  });
});
