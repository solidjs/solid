/**
 * #5233 — a cleanup that a landing's commits run calls a synchronous action.
 * (An effect's returned cleanup: an `onCleanup` belongs to its computation,
 * where calling an action is an owned call, #5123.)
 * The action's transaction became the flush's, and with nothing to wait on
 * it landed in the same landing loop, so the flush still pointed at it once
 * it had landed. The next action merged into that landed transaction: its
 * write showed, but was never committed, and a later write that compared
 * against the signal was skipped. A landed transaction holds nothing
 * (#5161); an action's writes commit once its body has returned and the work
 * it put in flight has landed (D-7).
 */
import { describe, expect, it } from "vitest";
import {
  action,
  createEffect,
  createMemo,
  createOptimistic,
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

type Mode = "effect" | "throws" | "async";

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
      createEffect(
        () => title(),
        () => () => void onClose().catch(() => {})
      );
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
  for (const mode of ["effect", "throws", "async"] as const) {
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
        createEffect(
          () => 1,
          () => () => void onClose()
        );
        return "Part";
      });
      createRenderEffect(branch, () => {});
      const titled = createMemo(() => {
        title();
        createEffect(
          () => 1,
          () => () => void second()
        );
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

  // The flush stops calling a landed transaction its own before the landing
  // ends its lanes, not only before its commits: a guess's `equals` runs when
  // the lane ends, and an action it starts must open a transaction of its
  // own. Merged into the landed one, its first write committed during its
  // `yield` instead of with its last. `regular commit` is the control: the
  // action starts from a cleanup the landing's commits run.
  for (const mode of ["regular commit", "lane teardown"] as const) {
    it(`${mode}: an action started while a transaction lands commits once, at its end`, async () => {
      const [open, setOpen] = createSignal(true);
      const [step, setStep] = createSignal(false);
      const [value, setValue] = createSignal(0);
      let running: Promise<void> | undefined;
      let release!: () => void;
      let resume!: () => void;
      const pause = new Promise<void>(r => (release = r));
      const third = action(function* () {
        setValue(1);
        yield pause;
        setValue(2);
      });
      const startThird = () => void (running ??= third());
      const [guess, setGuess] = createOptimistic(0, {
        equals(a, b) {
          // The lane ending lands its truth (0) over the guess (1).
          if (mode === "lane teardown" && a === 1 && b === 0) startThird();
          return a === b;
        }
      });
      const dispose = createRoot(dispose => {
        const branch = createMemo(() => {
          if (open()) onCleanup(() => resume());
          return open();
        });
        createRenderEffect(branch, () => {});
        const nested = createMemo(() => {
          if (!step() && mode === "regular commit")
            createEffect(
              () => 1,
              () => startThird
            );
          return step();
        });
        createRenderEffect(nested, () => {});
        createRenderEffect(guess, () => {});
        return dispose;
      });
      // Waits until the first action's commits run the branch's cleanup.
      const second = action(function* () {
        if (mode === "regular commit") setStep(true);
        else setGuess(1);
        yield {
          then(continuation: () => void) {
            resume = continuation;
          }
        };
      });
      const first = action(function* () {
        setOpen(false);
      });
      flush();
      const waiting = second();
      flush();
      expect(untrack(step)).toBe(false);
      if (mode === "lane teardown") expect(untrack(guess)).toBe(1);
      await first();
      await waiting;
      flush();
      expect(running).toBeDefined();
      const midway = untrack(value);
      release();
      await running;
      flush();
      const result = [midway, untrack(value)];
      dispose();
      expect(result).toEqual([0, 2]);
    });
  }
});
