/**
 * #5251 — a cleanup returned from an effect starts an action whose first
 * slice writes nothing and yields a pending promise. The cleanup runs in a
 * landing's commits, after the seam: the action's transaction became the
 * flush's, and with nothing staged no further round consumed it. It stayed
 * the flush's across flushes, and a later, unrelated action joined it on
 * entry — its write waited for the cleanup's action to end. Independent
 * actions commit separately (D-4, D-9); an ambient window is one flush, and
 * the action's own slices still rejoin its transaction (D-7). Having staged
 * nothing, it does not own the landing's effect phase either: an effect's
 * write reacting to the landed values commits (#5257's first case).
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
  onSettled,
  untrack
} from "../src/index.js";

const tick = () => new Promise(r => setTimeout(r, 0));

function gate() {
  let release!: () => void, fail!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => ((release = res), (fail = rej)));
  return { promise, release, fail };
}

/** A branch whose effect-returned cleanup calls `onClose` (as `<Show>` with a
 * child that does), closed by an action. `inCleanup: false` calls `onClose`
 * after the close instead (the control). */
function mount(onClose: () => void, inCleanup = true) {
  const [open, setOpen] = createSignal(true);
  const [plain, setPlain] = createSignal(0);
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
    createRenderEffect(plain, v => void (shown = v));
    return dispose;
  });
  flush();
  const close = async () => {
    await action(function* () {
      setOpen(false);
    })();
    if (!inCleanup) onClose();
    flush();
  };
  const bump = action(function* (v: number) {
    setPlain(v);
  });
  return { close, bump, read: () => [untrack(plain), shown], setPlain, dispose };
}

describe("#5251 an action a cleanup starts does not hold a later, unrelated action", () => {
  for (const inCleanup of [true, false]) {
    for (const turn of [false, true]) {
      it(`${inCleanup ? "cleanup" : "standalone"}: a later action${turn ? " after a timer turn" : ""} commits while the first waits`, async () => {
        const g = gate();
        let done: Promise<unknown> | undefined;
        const wait = action(function* () {
          yield g.promise;
        });
        const app = mount(() => void (done = wait()), inCleanup);
        await app.close();
        if (turn) await tick();
        await app.bump(2);
        await tick();
        expect(app.read()).toEqual([2, 2]);
        g.release();
        await done;
        await tick();
        expect(app.read()).toEqual([2, 2]);
        app.dispose();
      });
    }
  }

  it("an effect callback's action, started in the effect phase, holds no later action either", async () => {
    const g = gate();
    let done: Promise<unknown> | undefined;
    const wait = action(function* () {
      yield g.promise;
    });
    const [go, setGo] = createSignal(0);
    const [plain, setPlain] = createSignal(0);
    const dispose = createRoot(dispose => {
      createEffect(go, v => void (v && (done = wait())));
      return dispose;
    });
    flush();
    setGo(1);
    flush();
    await tick();
    await action(function* () {
      setPlain(2);
    })();
    await tick();
    expect(untrack(plain)).toBe(2);
    g.release();
    await done;
    dispose();
  });

  it("a later plain write commits while the cleanup's action waits", async () => {
    const g = gate();
    let done: Promise<unknown> | undefined;
    const wait = action(function* () {
      yield g.promise;
    });
    const app = mount(() => void (done = wait()));
    await app.close();
    app.setPlain(3);
    flush();
    expect(app.read()).toEqual([3, 3]);
    g.release();
    await done;
    app.dispose();
  });

  it("an action the same cleanup starts after it joins it, as in one tick outside a flush (D-7)", async () => {
    for (const inCleanup of [true, false]) {
      const g = gate();
      let done: Promise<unknown> | undefined, later: Promise<unknown> | undefined;
      const wait = action(function* () {
        yield g.promise;
      });
      const app = mount(() => {
        done = wait();
        later = app.bump(2);
      }, inCleanup);
      await app.close();
      await tick();
      expect(app.read()).toEqual([0, 0]);
      g.release();
      await Promise.all([done, later]);
      await tick();
      expect(app.read()).toEqual([2, 2]);
      app.dispose();
    }
  });

  it("the cleanup's action keeps its own write held; the unrelated one commits", async () => {
    const g = gate();
    let done: Promise<unknown> | undefined;
    const [own, setOwn] = createSignal(0);
    const wait = action(function* () {
      setOwn(1);
      yield g.promise;
    });
    const app = mount(() => void (done = wait()));
    await app.close();
    await tick();
    await app.bump(2);
    await tick();
    expect([untrack(own), ...app.read()]).toEqual([0, 2, 2]);
    g.release();
    await done;
    await tick();
    expect([untrack(own), ...app.read()]).toEqual([1, 2, 2]);
    app.dispose();
  });

  it("the cleanup's action rejecting: the unrelated write committed before and stays", async () => {
    const g = gate();
    let done: Promise<unknown> | undefined;
    const wait = action(function* () {
      yield g.promise;
    });
    const app = mount(() => void (done = wait()));
    await app.close();
    await tick();
    await app.bump(2);
    await tick();
    expect(app.read()).toEqual([2, 2]);
    g.fail(new Error("no ack"));
    await expect(done).rejects.toThrow("no ack");
    await tick();
    expect(app.read()).toEqual([2, 2]);
    await app.bump(4);
    expect(app.read()).toEqual([4, 4]);
    app.dispose();
  });

  it("resuming: the cleanup's action rejoins its own transaction and keeps its holds", async () => {
    const g1 = gate(),
      g2 = gate();
    let done: Promise<unknown> | undefined;
    const [own, setOwn] = createSignal(0);
    const [late, setLate] = createSignal(0);
    const wait = action(function* () {
      setOwn(1);
      yield g1.promise;
      setLate(1);
      yield g2.promise;
    });
    const app = mount(() => void (done = wait()));
    await app.close();
    await tick();
    await app.bump(2);
    g1.release();
    await tick();
    expect([untrack(own), untrack(late), ...app.read()]).toEqual([0, 0, 2, 2]);
    await app.bump(3);
    await tick();
    expect([untrack(own), untrack(late), ...app.read()]).toEqual([0, 0, 3, 3]);
    g2.release();
    await done;
    await tick();
    expect([untrack(own), untrack(late), ...app.read()]).toEqual([1, 1, 3, 3]);
    app.dispose();
  });

  // The landing's own effect phase: the cleanup's action has staged nothing,
  // so an effect's write reacting to the landed values is not its own.
  it("an effect's write reacting to the landing commits while the cleanup's action waits", async () => {
    for (const on of ["count", "open"] as const) {
      const g = gate();
      let done: Promise<unknown> | undefined;
      const wait = action(function* () {
        yield g.promise;
      });
      const [open, setOpen] = createSignal(true);
      const [count, setCount] = createSignal(0);
      const [total, setTotal] = createSignal(0);
      let shown = -1;
      const dispose = createRoot(dispose => {
        const branch = createMemo(() => {
          if (open())
            createEffect(
              () => 1,
              () => () => void (done = wait())
            );
          return open();
        });
        createRenderEffect(branch, () => {});
        if (on === "count") createEffect(count, c => void (c && setTotal(c * 10)));
        else createEffect(open, v => void (!v && setTotal(10)));
        createRenderEffect(total, v => void (shown = v));
        return dispose;
      });
      flush();
      await action(function* () {
        setOpen(false);
        setCount(1);
      })();
      await tick();
      expect([on, untrack(total), shown, isPending(total)]).toEqual([on, 10, 10, false]);
      g.release();
      await done;
      dispose();
    }
  });

  it("a cleanup's action that guesses and then waits: the guess shows over its hold, and an effect's write reacting to the close commits", async () => {
    const g = gate();
    let done: Promise<unknown> | undefined;
    const [guess, setGuess] = createOptimistic(0);
    const mark = action(function* () {
      setGuess(1);
      yield g.promise;
    });
    const [open, setOpen] = createSignal(true);
    const [total, setTotal] = createSignal(0);
    let shown = -1;
    const guesses: number[] = [];
    const dispose = createRoot(dispose => {
      const branch = createMemo(() => {
        if (open())
          createEffect(
            () => 1,
            () => () => void (done = mark())
          );
        return open();
      });
      createRenderEffect(branch, () => {});
      createEffect(open, v => void (!v && setTotal(10)));
      createRenderEffect(total, v => void (shown = v));
      createRenderEffect(guess, v => void guesses.push(v));
      return dispose;
    });
    flush();
    await action(function* () {
      setOpen(false);
    })();
    await tick();
    const whileWaiting = [untrack(total), shown, untrack(guess)];
    g.release();
    await done;
    for (let i = 0; i < 3; i++) {
      await tick();
      flush();
    }
    const after = [untrack(total), untrack(guess)];
    dispose();
    expect({ whileWaiting, after, guesses }).toEqual({
      whileWaiting: [10, 10, 1],
      after: [10, 0],
      guesses: [0, 1, 0]
    });
  });

  for (const owned of [true, false]) {
    it(`an action ${owned ? "an owned" : "an unowned"} onSettled starts that waits holds no later action`, async () => {
      const g = gate();
      let done: Promise<unknown> | undefined;
      const wait = action(function* () {
        yield g.promise;
      });
      const [plain, setPlain] = createSignal(0);
      let shown = -1;
      const dispose = createRoot(dispose => {
        if (owned) onSettled(() => void (done = wait()));
        createRenderEffect(plain, v => void (shown = v));
        return dispose;
      });
      flush();
      if (!owned) {
        onSettled(() => void (done = wait()));
        flush();
      }
      expect(done).toBeDefined();
      await action(function* () {
        setPlain(2);
      })();
      await tick();
      expect([untrack(plain), shown]).toEqual([2, 2]);
      g.release();
      await done;
      dispose();
    });
  }
});
