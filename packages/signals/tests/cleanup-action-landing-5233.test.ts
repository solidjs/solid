/**
 * #5233 — a cleanup that a landing's commits run calls a synchronous action.
 * The action's transaction became the flush's, and with nothing to wait on
 * it landed in the same landing loop, so the flush still pointed at it once
 * it had landed. The next action merged into that landed transaction: its
 * write showed, but was never committed, and a later write that compared
 * against the signal was skipped. A landed transaction holds nothing (D-9);
 * an action's writes commit when its body ends (D-7).
 */
import { describe, expect, it } from "vitest";
import {
  action,
  createEffect,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  onCleanup,
  untrack
} from "../src/index.js";

const tick = () => new Promise(r => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 3; i++) {
    await tick();
    flush();
  }
};

type Mode = "onCleanup" | "effect" | "throws" | "async";

async function run(mode: Mode) {
  const rendered: string[] = [];
  const committed: boolean[] = [];
  let shown = "";
  const [open, setOpen] = createSignal(false);
  const [title] = createSignal("title");
  const onClose =
    mode === "async"
      ? action(function* () {
          yield tick();
        })
      : mode === "throws"
        ? action(function* () {
            throw new Error("cleanup action");
          })
        : action(function* () {});
  const changeOpen = action(function* (value: boolean) {
    if (value !== untrack(open)) setOpen(value);
  });
  const dispose = createRoot(dispose => {
    createRenderEffect(
      () => (open() ? "T" : "F"),
      v => void (shown = v)
    );
    // A branch whose cleanup calls an action, as `<Show when={open()}>` with
    // a child that does.
    const branch = createMemo(() => {
      if (!open()) return null;
      if (mode === "effect")
        createEffect(
          () => title(),
          () => () => void onClose().catch(() => {})
        );
      else onCleanup(() => void onClose().catch(() => {}));
      return "Part";
    });
    createRenderEffect(branch, () => {});
    return dispose;
  });
  flush();
  await settle();
  rendered.push(shown);
  committed.push(untrack(open));
  for (const value of [true, false, true, false]) {
    await changeOpen(value);
    await settle();
    rendered.push(shown);
    committed.push(untrack(open));
  }
  dispose();
  return { rendered: rendered.join(" "), committed };
}

describe("#5233 an action called from a cleanup during a landing", () => {
  // `async` is the control: its transaction is still open when the landing
  // loop ends, so it never lands in it.
  for (const mode of ["onCleanup", "effect", "throws", "async"] as const) {
    it(`${mode}: the next action's write commits`, async () => {
      expect(await run(mode)).toEqual({
        rendered: "F T F T F",
        committed: [false, true, false, true, false]
      });
    });
  }

  it("a cleanup action whose write disposes another cleanup that calls an action", async () => {
    const [open, setOpen] = createSignal(false);
    const [title, setTitle] = createSignal("a");
    const [count, setCount] = createSignal(0);
    const second = action(function* () {
      setCount(c => c + 1);
    });
    const onClose = action(function* () {
      setTitle(t => t + "x");
    });
    const changeOpen = action(function* (value: boolean) {
      if (value !== untrack(open)) setOpen(value);
    });
    let shown = "";
    const dispose = createRoot(dispose => {
      createRenderEffect(
        () => `${open()} ${title()} ${count()}`,
        v => void (shown = v)
      );
      const branch = createMemo(() => {
        if (!open()) return null;
        onCleanup(() => void onClose());
        return "Part";
      });
      createRenderEffect(branch, () => {});
      const titled = createMemo(() => {
        title();
        onCleanup(() => void second());
        return "Title";
      });
      createRenderEffect(titled, () => {});
      return dispose;
    });
    flush();
    await settle();
    for (const value of [true, false, true, false, true]) {
      await changeOpen(value);
      await settle();
    }
    const result = [shown, untrack(open), untrack(title), untrack(count)];
    dispose();
    expect(result).toEqual(["true axx 2", true, "axx", 2]);
  });
});
