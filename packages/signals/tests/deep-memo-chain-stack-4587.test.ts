import { describe, expect, it } from "vitest";
import {
  createErrorBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending
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
