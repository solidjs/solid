/**
 * #5239 — a cleanup that a landing's commits run calls a synchronous action
 * whose only write is a guess. The guess was queued after the seam that
 * judges guesses, so a later round judged it under whatever transaction
 * that round had: an unrelated action's hold showed it while it waited.
 * The cleanup's frame commits with nothing held, so the guess is void
 * (D-33); a cleanup action that holds something shows its guess over its
 * own hold (D-7, F-11), with what its body read (D-33) — a hold its own
 * write starts included. A waiting one is not a later action's frame (D-4, D-9).
 *
 * The cleanup is one an effect callback returns: an `onCleanup` belongs to
 * its computation, where calling an action throws in dev (#5244).
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
  latest,
  untrack
} from "../src/index.js";

const tick = () => new Promise(r => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 3; i++) {
    await tick();
    flush();
  }
};
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => (resolve = r));
  return { promise, resolve };
}

/** `<Show when={open()}>` over a child whose cleanup calls `onClose`. */
function mount(onClose: () => Promise<unknown>) {
  const [guess, setGuess] = createOptimistic(0);
  const [open, setOpen] = createSignal(true);
  const rendered: number[] = [];
  const dispose = createRoot(dispose => {
    const panel = createMemo(() => {
      if (open())
        createEffect(
          () => 1,
          () => () => void onClose()
        );
      return open();
    });
    createRenderEffect(panel, () => {});
    createRenderEffect(guess, v => void rendered.push(v));
    return dispose;
  });
  const close = action(function* () {
    setOpen(false);
  });
  const read = () => [untrack(guess), untrack(() => latest(guess))];
  return { setGuess, close, read, rendered, dispose };
}

describe("#5239 a guess written by a cleanup's action", () => {
  it("is void when the action holds nothing: an unrelated action never shows it", async () => {
    let setGuess!: (v: number) => void;
    const app = mount(
      action(function* () {
        setGuess(1);
      })
    );
    setGuess = app.setGuess;
    flush();
    const gate = deferred();
    const unrelated = action(function* () {
      yield gate.promise;
    });
    const readings: number[][] = [];
    await app.close();
    await settle();
    readings.push(app.read());
    const waiting = unrelated();
    await settle();
    readings.push(app.read());
    gate.resolve();
    await waiting;
    await settle();
    readings.push(app.read());
    const rendered = app.rendered.slice();
    app.dispose();
    expect(readings).toEqual([
      [0, 0],
      [0, 0],
      [0, 0]
    ]);
    // Never shown. (The void lane's reader re-derives once on the landed
    // value, as when the same action runs in a microtask of its own.)
    expect(rendered).not.toContain(1);
  });

  it("is void with no later action: a later plain write commits and 1 never renders", async () => {
    let setGuess!: (v: number | ((p: number) => number)) => void;
    const app = mount(
      action(function* () {
        setGuess(1);
      })
    );
    setGuess = app.setGuess;
    flush();
    await app.close();
    await settle();
    const after = app.read();
    const [other, setOther] = createSignal(0);
    setOther(1);
    await settle();
    const rendered = app.rendered.slice();
    app.dispose();
    expect([after, untrack(other)]).toEqual([[0, 0], 1]);
    expect(rendered).not.toContain(1);
  });

  // Control: the action's signal write keeps the flush going, so its guess
  // opened its lane over the action's hold before the fix too.
  it("shows over the action's own hold while it waits, and reverts when it lands", async () => {
    const gate = deferred();
    const [count, setCount] = createSignal(0);
    let setGuess!: (v: number) => void;
    const app = mount(
      action(function* () {
        setCount(1);
        setGuess(1);
        yield gate.promise;
      })
    );
    setGuess = app.setGuess;
    flush();
    await app.close();
    await settle();
    const waiting = [...app.read(), untrack(count)];
    gate.resolve();
    await settle();
    const landed = [...app.read(), untrack(count)];
    const rendered = app.rendered.slice();
    app.dispose();
    expect({ waiting, landed, rendered }).toEqual({
      waiting: [1, 1, 0],
      landed: [0, 0, 1],
      rendered: [0, 1, 0]
    });
  });

  // The plain write starts async work only once its pass runs: the guess
  // is judged after that pass, so it shows over the hold the pass finds —
  // as when the same writes run on their own.
  it.each(["cleanup action", "direct cleanup", "standalone"])(
    "a guess written with a plain write (%s) shows over async derived from that write",
    async mode => {
      const gate = deferred();
      const [open, setOpen] = createSignal(true);
      const [source, setSource] = createSignal(0);
      const [guess, setGuess] = createOptimistic(0);
      const shown: number[] = [];
      const guessed: number[] = [];
      const change = action(function* () {
        setGuess(1);
        setSource(1);
      });
      const dispose = createRoot(dispose => {
        const panel = createMemo(() => {
          if (open() && mode !== "standalone")
            createEffect(
              () => 1,
              () =>
                mode === "direct cleanup"
                  ? () => {
                      setGuess(1);
                      setSource(1);
                    }
                  : () => void change()
            );
          return open();
        });
        const data = createMemo(() => (source() ? gate.promise.then(() => 9) : 0));
        createRenderEffect(panel, () => {});
        createRenderEffect(data, v => void shown.push(v));
        createRenderEffect(guess, v => void guessed.push(v));
        return dispose;
      });
      flush();
      if (mode !== "standalone")
        await action(function* () {
          setOpen(false);
        })();
      else await change();
      await settle();
      const waiting = [untrack(source), untrack(guess), shown.at(-1), guessed.at(-1)];
      gate.resolve();
      await settle();
      const landed = [untrack(source), untrack(guess), shown.at(-1), guessed.at(-1)];
      dispose();
      expect({ waiting, landed }).toEqual({ waiting: [0, 1, 0, 1], landed: [1, 0, 9, 0] });
    }
  );

  // D-4, D-9: a cleanup's action whose guess nobody reads, waiting, is not
  // the frame of a later, disjoint action; the two commit separately.
  it("a waiting cleanup action with an unobserved guess does not hold a later disjoint action", async () => {
    const gate = deferred();
    const [, setGuess] = createOptimistic(0);
    const [open, setOpen] = createSignal(true);
    const [plain, setPlain] = createSignal(0);
    const guessing = action(function* () {
      setGuess(1);
      yield gate.promise;
    });
    let waiting: Promise<unknown> | undefined;
    const dispose = createRoot(dispose => {
      const panel = createMemo(() => {
        if (open())
          createEffect(
            () => 1,
            () => () => void (waiting = guessing())
          );
        return open();
      });
      createRenderEffect(panel, () => {});
      return dispose;
    });
    flush();
    await action(function* () {
      setOpen(false);
    })();
    await settle();
    await action(function* () {
      setPlain(2);
    })();
    await settle();
    const whileWaiting = untrack(plain);
    gate.resolve();
    await waiting;
    await settle();
    const after = untrack(plain);
    dispose();
    expect([whileWaiting, after]).toEqual([2, 2]);
  });

  it("a guess-only action that waits shows its guess while it waits", async () => {
    const gate = deferred();
    let setGuess!: (v: number) => void;
    const app = mount(
      action(function* () {
        setGuess(1);
        yield gate.promise;
      })
    );
    setGuess = app.setGuess;
    flush();
    await app.close();
    await settle();
    const waiting = app.read();
    gate.resolve();
    await settle();
    const landed = app.read();
    const rendered = app.rendered.slice();
    app.dispose();
    expect({ waiting, landed, rendered }).toEqual({
      waiting: [1, 1],
      landed: [0, 0],
      rendered: [0, 1, 0]
    });
  });

  it("is void when the action holds nothing, even if an effect reacting to the close starts an unrelated action", async () => {
    const gate = deferred();
    const unrelated = action(function* () {
      yield gate.promise;
    });
    const [guess, setGuess] = createOptimistic(0);
    const [open, setOpen] = createSignal(true);
    const markClosed = action(function* () {
      setGuess(1);
    });
    const rendered: number[] = [];
    let waiting: Promise<unknown> | undefined;
    const dispose = createRoot(dispose => {
      const panel = createMemo(() => {
        if (open())
          createEffect(
            () => 1,
            () => () => void markClosed()
          );
        return open();
      });
      createRenderEffect(panel, () => {});
      createRenderEffect(guess, v => void rendered.push(v));
      createEffect(open, v => {
        if (!v) waiting = unrelated();
      });
      return dispose;
    });
    flush();
    await action(function* () {
      setOpen(false);
    })();
    await settle();
    const whileWaiting = [untrack(guess), untrack(() => latest(guess))];
    gate.resolve();
    await waiting;
    await settle();
    const after = [untrack(guess), untrack(() => latest(guess))];
    dispose();
    expect({ whileWaiting, after }).toEqual({ whileWaiting: [0, 0], after: [0, 0] });
    expect(rendered).not.toContain(1);
  });

  it("keeps what the action's body read: a guess over another hold's guess shows over that hold", async () => {
    const gate = deferred();
    const [a, setA] = createOptimistic(0);
    const [b, setB] = createOptimistic(0);
    const [open, setOpen] = createSignal(true);
    const first = action(function* () {
      setA(1);
      yield gate.promise;
    });
    const second = action(function* () {
      setB(a() + 1);
    });
    const rendered: (readonly number[])[] = [];
    const dispose = createRoot(dispose => {
      const panel = createMemo(() => {
        if (open())
          createEffect(
            () => 1,
            () => () => void second()
          );
        return open();
      });
      createRenderEffect(panel, () => {});
      createRenderEffect(
        () => [a(), b()],
        v => void rendered.push(v)
      );
      return dispose;
    });
    flush();
    const waiting = first();
    flush();
    await action(function* () {
      setOpen(false);
    })();
    await settle();
    const whileFirstWaits = [untrack(a), untrack(b)];
    gate.resolve();
    await waiting;
    await settle();
    const landed = [untrack(a), untrack(b)];
    dispose();
    // As when `second` runs in a microtask of its own: `b`'s guess read
    // `first`'s, so it lives as long as `first`'s hold (D-33).
    expect({ whileFirstWaits, landed }).toEqual({ whileFirstWaits: [1, 2], landed: [0, 0] });
    expect(rendered).toContainEqual([1, 2]);
  });

  // Not a cleanup: a guess an `equals` writes while the seam judges a
  // re-guess is judged in the same walk, over the same hold (D-33).
  it("a guess an `equals` writes while judging a re-guess lives as long as that hold", async () => {
    const first = deferred();
    const second = deferred();
    let arm = false;
    const [b, setB] = createOptimistic(0);
    const [a, setA] = createOptimistic(0, {
      equals(x: number, y: number) {
        if (arm) {
          arm = false;
          setB(7);
        }
        return x === y;
      }
    });
    const rendered: (readonly number[])[] = [];
    const dispose = createRoot(dispose => {
      createRenderEffect(
        () => [a(), b()],
        v => void rendered.push(v)
      );
      return dispose;
    });
    flush();
    const done = action(function* () {
      setA(1);
      yield first.promise;
      setA(2);
      arm = true;
      yield second.promise;
    })();
    await settle();
    first.resolve();
    await settle();
    const whileHeld = [untrack(a), untrack(b)];
    second.resolve();
    await done;
    await settle();
    const landed = [untrack(a), untrack(b)];
    dispose();
    expect({ whileHeld, landed }).toEqual({ whileHeld: [2, 7], landed: [0, 0] });
    expect(rendered).toContainEqual([2, 7]);
  });
});
