import {
  action,
  createOptimistic,
  createRenderEffect,
  createRoot,
  createSignal,
  flush
} from "../src/index.js";

declare const __DEV__: boolean;

// #3333. An action's writes are held by its transaction until it settles;
// imperative reads in the body see committed state (semantics, not a bug).
// The reporter's "leading flush()" workaround only appeared to help because
// flush()'s drain loop exits when `activeTransition` is null — it parked the
// transaction mid-slice and the writes that followed landed as plain,
// committed writes, visible on screen before the action finished. flush()
// inside a body is refused: DEV throws, prod skips the drain.
//
// The file is tier-aware so `SIGNALS_TIER=prod vitest run tests/flush-in-action`
// exercises the no-op path.

afterEach(() => flush());

function setup() {
  let signal!: () => number, setSignal!: (v: number) => void;
  let optimistic!: () => number;
  const seen: number[] = [];
  createRoot(() => {
    [signal, setSignal] = createSignal(0);
    [optimistic] = createOptimistic(signal);
    createRenderEffect(
      () => optimistic(),
      v => {
        seen.push(v);
      }
    );
  });
  flush();
  return { signal, setSignal, optimistic, seen };
}

describe("flush() inside an action body (#3333)", () => {
  it("is refused: DEV throws FLUSH_IN_ACTION and the action rejects; prod skips the drain", async () => {
    const { setSignal, seen } = setup();
    let threw: unknown = null;
    const run = action(function* () {
      try {
        flush();
      } catch (e) {
        threw = e;
        throw e;
      }
      setSignal(1);
      yield Promise.resolve();
    });
    if (__DEV__) {
      await expect(run()).rejects.toThrow(/FLUSH_IN_ACTION/);
      expect(String(threw)).toContain("FLUSH_IN_ACTION");
      flush();
      expect(seen).toEqual([0]); // nothing leaked; the write never happened
    } else {
      await run();
      flush();
      expect(threw).toBeNull();
      expect(seen).toEqual([0, 1]);
    }
  });

  it("prod: a write after an in-body flush() stays in the transaction (the leak)", async () => {
    if (__DEV__) return; // covered by the throw above
    const { signal, setSignal, optimistic, seen } = setup();
    let mid: number[] = [];
    let release!: () => void;
    const gate = new Promise<void>(r => (release = r));
    const run = action(function* () {
      flush(); // leading flush: used to park the transaction and detach what follows
      setSignal(1);
      flush(); // used to commit the detached write to the screen mid-action
      mid = [optimistic(), signal(), seen.length];
      yield gate;
    });
    const done = run();
    flush();
    // Reads in the body see committed state; the effect saw nothing new.
    expect(mid).toEqual([0, 0, 1]);
    expect(seen).toEqual([0]);
    release();
    await done;
    flush();
    expect(seen).toEqual([0, 1]);
  });

  it("flush(fn) inside a body: DEV throws before running fn; prod runs fn without draining", async () => {
    const { setSignal, seen } = setup();
    let ran = false;
    const run = action(function* () {
      flush(() => {
        ran = true;
        setSignal(1);
      });
      yield Promise.resolve();
    });
    if (__DEV__) {
      await expect(run()).rejects.toThrow(/FLUSH_IN_ACTION/);
      expect(ran).toBe(false);
    } else {
      const done = run();
      flush();
      expect(ran).toBe(true);
      expect(seen).toEqual([0]); // held, not committed mid-action
      await done;
      flush();
      expect(seen).toEqual([0, 1]);
    }
  });

  it("run(); flush() in the caller is not inside the body and still parks the transaction", async () => {
    const { signal, setSignal, seen } = setup();
    let release!: () => void;
    const gate = new Promise<void>(r => (release = r));
    const run = action(function* () {
      setSignal(1);
      yield gate;
    });
    const done = run();
    expect(() => flush()).not.toThrow();
    expect(signal()).toBe(0);
    expect(seen).toEqual([0]);
    release();
    await done;
    flush();
    expect(signal()).toBe(1);
    expect(seen).toEqual([0, 1]);
  });

  it("a nested action resuming synchronously inside the outer body does not detach the outer writes", async () => {
    const { signal, setSignal, seen } = setup();
    const inner = action(function* () {
      yield 5; // non-thenable: resumes synchronously via restoreTransition
      yield 6;
    });
    let release!: () => void;
    const gate = new Promise<void>(r => (release = r));
    const outer = action(function* () {
      inner();
      setSignal(1); // after the nested action's internal resumption
      yield gate;
    });
    const done = outer();
    flush();
    expect(signal()).toBe(0);
    expect(seen).toEqual([0]); // still held
    release();
    await done;
    flush();
    expect(signal()).toBe(1);
    expect(seen).toEqual([0, 1]);
  });

  it("the depth counter unwinds when the body throws", async () => {
    const run = action(function* () {
      throw new Error("boom");
      // eslint-disable-next-line no-unreachable
      yield;
    });
    await expect(run()).rejects.toThrow("boom");
    expect(() => flush()).not.toThrow();
  });
});
