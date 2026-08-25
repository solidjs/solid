/**
 * Regression pins for the four affects() audit bugs in #2893. Shared theme of
 * bugs 2-4: marks ride the async status rails but skipped the mechanisms that
 * make those rails self-healing (dirtying on landing, re-throw on read), so
 * states real async recovers from were terminal for marks.
 */
import { describe, expect, it } from "vitest";
import {
  action,
  affects,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  isPending,
  mapArray
} from "../src/index.js";

describe("bug 1: addPendingSource dual state", () => {
  it("a memo over three marked signals settles when the marks release", async () => {
    const [a] = createSignal(1);
    const [b] = createSignal(2);
    const [c] = createSignal(3);
    let sum!: () => number;
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      sum = createMemo(() => a() + b() + c());
      createRenderEffect(sum, () => {});
    });
    flush();

    let resolveIt!: () => void;
    const act = action(function* () {
      affects(a);
      affects(b);
      affects(c);
      yield new Promise<void>(r => (resolveIt = r));
    });
    const done = act();
    flush();
    expect(isPending(() => sum())).toBe(true);

    resolveIt();
    await done;
    flush();
    expect(isPending(() => sum())).toBe(false); // was stuck true forever
    dispose();
  });

  it("keyless store mark over a live mapArray releases at settle (#2893 flagship)", async () => {
    const [state] = createStore({ rows: [{ name: "a" }] });
    let mapped!: () => string[];
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      const rows = mapArray(
        () => state.rows,
        r => r.name
      );
      mapped = createMemo(() => rows());
      createRenderEffect(mapped, () => {});
    });
    flush();

    let resolveIt!: () => void;
    const act = action(function* () {
      affects(state); // keyless: covers rows leaf + length + $TRACK
      yield new Promise<void>(r => (resolveIt = r));
    });
    const done = act();
    flush();
    expect(isPending(() => mapped())).toBe(true);

    resolveIt();
    await done;
    flush();
    expect(isPending(() => mapped())).toBe(false); // was stuck true forever
    dispose();
  });
});

describe("bug 3: transitive re-establishment", () => {
  it("depth-2 memos keep reporting pending across repeated probes", async () => {
    const [s] = createSignal(1);
    let b!: () => number;
    let c!: () => number;
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      b = createMemo(() => s() * 2);
      c = createMemo(() => b() + 1);
      createRenderEffect(c, () => {});
    });
    flush();

    let resolveIt!: () => void;
    const act = action(function* () {
      affects(s);
      yield new Promise<void>(r => (resolveIt = r));
    });
    const done = act();
    flush();
    expect(isPending(() => c())).toBe(true);
    expect(isPending(() => c())).toBe(true); // probe must not strip it
    expect(isPending(() => b())).toBe(true);
    expect(isPending(() => c())).toBe(true);

    resolveIt();
    await done;
    flush();
    expect(isPending(() => c())).toBe(false);
    dispose();
  });

  it("a depth-2 memo re-acquires pending after an unrelated-dep recompute", async () => {
    const [s] = createSignal(1);
    const [other, setOther] = createSignal(100);
    let b!: () => number;
    let c!: () => number;
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      b = createMemo(() => s() * 2);
      c = createMemo(() => b() + other());
      createRenderEffect(c, () => {});
    });
    flush();

    let resolveIt!: () => void;
    const act = action(function* () {
      affects(s);
      yield new Promise<void>(r => (resolveIt = r));
    });
    const done = act();
    flush();
    expect(isPending(() => c())).toBe(true);

    setOther(200); // dirties c through the unmarked leg
    flush();
    expect(c()).toBe(202); // mark is value-transparent: fresh value flows
    expect(isPending(() => c())).toBe(true); // and pending survives the recompute

    resolveIt();
    await done;
    flush();
    expect(isPending(() => c())).toBe(false);
    expect(c()).toBe(202);
    dispose();
  });

  it("a memo chain created DURING the window acquires pending past depth 1", async () => {
    const [s] = createSignal(1);
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
    });

    let resolveIt!: () => void;
    const act = action(function* () {
      affects(s);
      yield new Promise<void>(r => (resolveIt = r));
    });
    const done = act();
    flush();

    // Built mid-window: registration-time propagation never saw these nodes,
    // so coverage comes entirely from read-path collection.
    let b!: () => number;
    let c!: () => number;
    createRoot(d => {
      const prev = dispose;
      dispose = () => {
        prev();
        d();
      };
      b = createMemo(() => s() * 2);
      c = createMemo(() => b() + 1);
      createRenderEffect(c, () => {});
    });
    flush();
    expect(isPending(() => b())).toBe(true);
    expect(isPending(() => c())).toBe(true);

    resolveIt();
    await done;
    flush();
    expect(isPending(() => c())).toBe(false);
    dispose();
  });
});

describe("bug 2: no transaction capture through mark propagation", () => {
  it("a plain write to an unmarked signal sharing a memo stays live during the action", async () => {
    const [count] = createSignal(1);
    const [other, setOther] = createSignal(10);
    let sum!: () => number;
    let dispose!: () => void;
    const sums: number[] = [];
    createRoot(d => {
      dispose = d;
      sum = createMemo(() => count() + other());
      createRenderEffect(sum, v => {
        sums.push(v);
      });
    });
    flush();
    expect(sums).toEqual([11]);

    let resolveIt!: () => void;
    const act = action(function* () {
      affects(count); // mark on count ONLY
      yield new Promise<void>(r => (resolveIt = r));
    });
    const done = act();
    flush();

    setOther(20); // plain write to an unmarked, unrelated signal
    flush();
    expect(other()).toBe(20); // must not be transition-held
    expect(isPending(() => other())).toBe(false); // no false pending on unmarked data
    expect(sum()).toBe(21); // memo recomputed with the fresh value

    resolveIt();
    await done;
    flush();
    expect(isPending(() => sum())).toBe(false);
    expect(sums.at(-1)).toBe(21);
    dispose();
  });

  it("a plain write to the MARKED signal itself commits immediately", async () => {
    const [count, setCount] = createSignal(1);
    let m!: () => number;
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      m = createMemo(() => count() * 10);
      createRenderEffect(m, () => {});
    });
    flush();

    let resolveIt!: () => void;
    const act = action(function* () {
      affects(count);
      yield new Promise<void>(r => (resolveIt = r));
    });
    const done = act();
    flush();

    setCount(2); // marks are value-transparent: the write must not be held
    flush();
    expect(count()).toBe(2);
    expect(m()).toBe(20);
    expect(isPending(() => count())).toBe(true); // mark still live, still reports

    resolveIt();
    await done;
    flush();
    expect(isPending(() => count())).toBe(false);
    dispose();
  });
});

describe("bug 4: real errors survive marks", () => {
  it("a memo throwing under a mark surfaces its own error, not NotReadyError", async () => {
    const [s] = createSignal(1);
    let m!: () => number;
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      m = createMemo((): number => {
        s();
        throw new Error("boom");
      });
    });

    let resolveIt!: () => void;
    const act = action(function* () {
      affects(s);
      yield new Promise<void>(r => (resolveIt = r));
    });
    const done = act();
    flush();

    // First pull recomputes under the live mark: the recompute reads the
    // marked signal (collecting it) and then throws. applyAffectsReads used
    // to run anyway and clobber the boom with the sentinel's NotReadyError.
    expect(() => m()).toThrow("boom");

    resolveIt();
    await done;
    flush();
    expect(() => m()).toThrow("boom");
    dispose();
  });
});
