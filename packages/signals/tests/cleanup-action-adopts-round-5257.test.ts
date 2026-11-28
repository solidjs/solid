/**
 * #5257 — a cleanup returned from an effect starts an action that waits and
 * stages nothing. The cleanup runs while a landing commits, after the seam,
 * and the action's transaction became the flush's. An effect reacting to the
 * landed values writes `total`, which the same drain carries in its next
 * round; that round's seam parked the round into the waiting action, so
 * `total` waited for an action that never wrote it. With nothing staged, the
 * action has no frame in that round (D-4, D-9), and a corrected guess reveals
 * with its own hold (F-11). Its later slices still rejoin it (D-7).
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
  isPending,
  latest,
  refresh,
  untrack
} from "../src/index.js";

const tick = () => new Promise(r => setTimeout(r, 0));

function gate() {
  let release!: () => void;
  const promise = new Promise<void>(res => (release = res));
  return { promise, release };
}

/** `close` closes a branch and sets `count`; an effect sets `total` from it.
 * The branch's effect-returned cleanup calls `onClose` (`inCleanup: false`:
 * called after the close instead, the control). */
function mount(onClose: () => void, inCleanup = true, closeAsync = false) {
  const [open, setOpen] = createSignal(true);
  const [count, setCount] = createSignal(0);
  const [total, setTotal] = createSignal(0);
  let shown = -1;
  const dispose = createRoot(dispose => {
    const branch = createMemo(() => {
      if (open() && inCleanup)
        createEffect(
          () => 1,
          () => () => onClose()
        );
      return open();
    });
    createRenderEffect(branch, () => {});
    createEffect(count, c => void (c && setTotal(c * 10)));
    createRenderEffect(total, v => void (shown = v));
    return dispose;
  });
  flush();
  const close = async () => {
    await action(function* () {
      setOpen(false);
      setCount(1);
      if (closeAsync) yield Promise.resolve();
    })();
    if (!inCleanup) onClose();
    await tick();
  };
  return { close, read: () => [untrack(total), shown, isPending(total)], dispose };
}

describe("#5257 a cleanup's waiting action that staged nothing does not hold the drain's next round", () => {
  for (const inCleanup of [true, false])
    for (const closeAsync of [false, true])
      it(`${inCleanup ? "cleanup" : "standalone"}${closeAsync ? ", async close" : ""}: an effect's write reacting to the landing commits while the action waits`, async () => {
        const g = gate();
        let done: Promise<unknown> | undefined;
        const wait = action(function* () {
          yield g.promise;
        });
        const app = mount(() => void (done = wait()), inCleanup, closeAsync);
        await app.close();
        expect(app.read()).toEqual([10, 10, false]);
        g.release();
        await done;
        await tick();
        expect(app.read()).toEqual([10, 10, false]);
        app.dispose();
      });

  it("a write after the action's first yield rejoins it and stays held (D-7)", async () => {
    const g = gate();
    let done: Promise<unknown> | undefined;
    const [own, setOwn] = createSignal(0);
    let ownShown = -1;
    const wait = action(function* () {
      yield Promise.resolve();
      setOwn(1);
      yield g.promise;
    });
    const stop = createRoot(dispose => {
      createRenderEffect(own, v => void (ownShown = v));
      return dispose;
    });
    const app = mount(() => void (done = wait()));
    await app.close();
    await tick();
    expect([untrack(own), ownShown, isPending(own), ...app.read()]).toEqual([
      0,
      0,
      true,
      10,
      10,
      false
    ]);
    g.release();
    await done;
    await tick();
    expect([untrack(own), ownShown, isPending(own)]).toEqual([1, 1, false]);
    stop();
    app.dispose();
  });

  it("a guess-only waiting action shows its guess while it waits; the effect's write commits", async () => {
    const g = gate();
    let done: Promise<unknown> | undefined;
    const [guess, setGuess] = createOptimistic(0);
    const guessed: number[] = [];
    const wait = action(function* () {
      setGuess(1);
      yield g.promise;
    });
    const stop = createRoot(dispose => {
      createRenderEffect(guess, v => void guessed.push(v));
      return dispose;
    });
    const app = mount(() => void (done = wait()));
    await app.close();
    expect([guessed.at(-1), ...app.read()]).toEqual([1, 10, 10, false]);
    g.release();
    await done;
    await tick();
    expect([guessed, ...app.read()]).toEqual([[0, 1, 0], 10, 10, false]);
    stop();
    app.dispose();
  });

  it("a corrected guess shows at its own action's landing, not when the cleanup's action ends (F-11)", async () => {
    const g = gate(),
      saving = gate();
    let done: Promise<unknown> | undefined;
    let server = "A";
    const wait = action(function* () {
      yield g.promise;
    });
    const [open, setOpen] = createSignal(true);
    let shown = "";
    const [read, guess, dispose] = createRoot(dispose => {
      const [read, guess] = createOptimistic(async () => {
        await Promise.resolve();
        return server;
      });
      const branch = createMemo(() => {
        if (open())
          createEffect(
            () => 1,
            () => () => void (done = wait())
          );
        return open();
      });
      createRenderEffect(branch, () => {});
      createRenderEffect(read, v => void (shown = v));
      return [read, guess, dispose] as const;
    });
    flush();
    await tick();
    const save = action(function* () {
      guess("Guess");
      setOpen(false);
      yield saving.promise;
    })();
    await tick();
    expect(shown).toBe("Guess");
    server = "B";
    refresh(read);
    await tick();
    flush();
    saving.release();
    await save;
    await tick();
    flush();
    expect([shown, untrack(read), latest(read), isPending(read)]).toEqual(["B", "B", "B", false]);
    g.release();
    await done;
    dispose();
  });

  // Standing, unchanged (D-4): an effect phase is one tick, so a write
  // another effect makes in it joins an action an effect starts there.
  for (const writeFirst of [false, true])
    it(`an effect-phase write ${writeFirst ? "before" : "after"} an effect starts a waiting action is held with it`, async () => {
      const g = gate();
      let done: Promise<unknown> | undefined;
      const [go, setGo] = createSignal(0);
      const [z, setZ] = createSignal(0);
      const wait = action(function* () {
        yield g.promise;
      });
      const write = () => void (go() && setZ(10));
      const start = () => void (go() && (done = wait()));
      const dispose = createRoot(dispose => {
        createEffect(go, writeFirst ? write : start);
        createEffect(go, writeFirst ? start : write);
        createRenderEffect(z, () => {});
        return dispose;
      });
      flush();
      setGo(1);
      await tick();
      expect([untrack(z), isPending(z)]).toEqual([0, true]);
      g.release();
      await done;
      await tick();
      expect([untrack(z), isPending(z)]).toEqual([10, false]);
      dispose();
    });

  // Standing, unchanged (D-4, D-7): outside a flush the tick is one frame,
  // so a write made in the same tick as a waiting action's start is its.
  it("a handler's `wait(); setZ(10)` still holds z with the action (one tick)", async () => {
    const g = gate();
    const [z, setZ] = createSignal(0);
    const wait = action(function* () {
      yield g.promise;
    });
    const done = wait();
    setZ(10);
    await tick();
    expect([untrack(z), isPending(z)]).toEqual([0, true]);
    g.release();
    await done;
    await tick();
    expect([untrack(z), isPending(z)]).toEqual([10, false]);
  });
});
