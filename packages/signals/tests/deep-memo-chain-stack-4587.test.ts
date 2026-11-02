import { describe, expect, it } from "vitest";
import {
  createErrorBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  onCleanup
} from "../src/index.js";

// #4587: a long memo chain over an async source must not overflow the stack
// on the pending / settle / staged-error walks. The settled frame is the
// same at every depth, and none is dropped.

async function settle() {
  for (let r = 0; r < 3; r++) {
    for (let i = 0; i < 10; i++) await Promise.resolve();
    flush();
  }
}

async function setup(n: number) {
  const flights: [(v: number) => void, (e: unknown) => void][] = [];
  const [q, setQ] = createSignal(0);
  const frames: string[] = [];
  const disposers: (() => void)[] = [];
  let src!: () => number;
  createRoot(d => {
    disposers.push(d);
    src = createMemo(() => {
      q();
      return new Promise<number>((res, rej) => flights.push([res, rej]));
    });
    createRenderEffect(
      createErrorBoundary(src, () => null),
      () => {}
    );
  });
  flush();
  flights[0][0](1);
  await settle();
  // Warm build: the chain is made after the source holds its first value.
  createRoot(d => {
    disposers.push(d);
    let last = src;
    for (let i = 0; i < n; i++) {
      const prev = last;
      last = createMemo(() => prev());
    }
    const tail = last;
    const b = createErrorBoundary(
      () => `V:${tail()}${isPending(tail) ? ":p" : ""}`,
      err => `E:${(err() as Error).message}`
    );
    createRenderEffect(b, v => {
      frames.push(v as string);
    });
  });
  flush();
  expect(frames).toEqual(["V:1"]);
  setQ(1);
  flush();
  expect(frames).toEqual(["V:1", "V:1:p"]);
  return { flight: flights[1], frames, dispose: () => disposers.forEach(d => d()) };
}

describe("#4587: deep memo chain over an async source", () => {
  for (const n of [1, 500, 20000]) {
    it(`a rejecting flight shows E:boomA, no frame dropped (N=${n})`, async () => {
      const { flight, frames, dispose } = await setup(n);
      flight[1](new Error("boomA"));
      await settle();
      expect(frames).toEqual(["V:1", "V:1:p", "E:boomA"]);
      dispose();
    });

    it(`a resolving flight commits the new value (N=${n})`, async () => {
      const { flight, frames, dispose } = await setup(n);
      flight[0](2);
      await settle();
      expect(frames).toEqual(["V:1", "V:1:p", "V:2"]);
      dispose();
    });
  }
});

// The walks stay depth first: a held diamond's memos commit (and so run
// their cleanups) in the order the recursion gave.
describe("#4587: the walks keep their depth-first order", () => {
  const tick = async () => {
    for (let i = 0; i < 3; i++) {
      await new Promise(r => setTimeout(r, 0));
      flush();
    }
  };
  it("commit order of a held diamond's memos (onCleanup order) is unchanged", async () => {
    const [s, setS] = createSignal(0);
    const res: (() => void)[] = [];
    const log: string[] = [];
    const memo = (name: string, fn: () => any) =>
      createMemo(() => {
        onCleanup(() => log.push(name));
        return fn();
      });
    const A = memo("A", () => {
      const v = s();
      return new Promise(r => res.push(() => r(v)));
    });
    const B = memo("B", () => A() + 1);
    const X = memo("X", () => A() + 2);
    const Y = memo("Y", () => B() + X());
    const dispose = createRoot(d => {
      createRenderEffect(
        () => {
          try {
            return Y();
          } catch {
            return "p";
          }
        },
        () => {}
      );
      return d;
    });
    flush();
    res.shift()!();
    await tick();
    setS(1);
    flush();
    log.length = 0;
    res.shift()!();
    await tick();
    expect(log).toEqual(["B", "Y", "X", "A"]);
    dispose();
  });
});

// The dirty mark of a signal write (heap.ts `markNode`) walks the same way.
describe("#4587: a write marks a deep chain without recursion", () => {
  it("a write to the head of a 50,000-memo chain reaches its effect", () => {
    const N = 50000;
    const [s, set] = createSignal(0);
    let seen = -1;
    const dispose = createRoot(d => {
      let last: () => number = s;
      for (let i = 0; i < N; i++) {
        const prev = last;
        last = createMemo(() => prev() + 1);
      }
      createRenderEffect(last, v => {
        seen = v;
      });
      return d;
    });
    flush();
    expect(seen).toBe(N);
    set(1);
    flush();
    expect(seen).toBe(N + 1);
    dispose();
  });
});
