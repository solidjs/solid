// #5038 (D-8): an equal rewrite of a held slot joins the hold but has nothing to flush.
import { afterEach, describe, expect, it } from "vitest";
import {
  action,
  createEffect,
  createRoot,
  createSignal,
  DEV,
  flush,
  resetErrorHalt
} from "../src/index.js";

afterEach(() => {
  DEV!.hooks.onUpdate = undefined;
  resetErrorHalt();
});

describe("#5038: an equal rewrite of a held slot schedules no flush", () => {
  it("does not flush for a rewrite with the staged value", async () => {
    const entries: number[] = [];
    const [s, setS] = createSignal(entries);
    const seen: number[][] = [];
    const dispose = createRoot(d => {
      createEffect(s, v => void seen.push(v));
      return d;
    });
    flush();
    let resolve!: () => void;
    const next = [1];
    const act = action(function* () {
      setS(next);
      yield new Promise<void>(r => (resolve = r));
    });
    act();
    flush();
    await Promise.resolve();
    flush();

    let flushes = 0;
    DEV!.hooks.onUpdate = () => void flushes++;
    setS(next);
    await Promise.resolve();
    await Promise.resolve();
    expect(flushes).toBe(0);

    DEV!.hooks.onUpdate = undefined;
    resolve();
    await new Promise(r => setTimeout(r, 0));
    flush();
    expect(seen).toEqual([entries, next]);
    dispose();
  });

  it("still joins the tick's other writes to the hold", async () => {
    const [s, setS] = createSignal(0);
    const [t, setT] = createSignal(0);
    const seen: number[] = [];
    const dispose = createRoot(d => {
      createEffect(s, () => {});
      createEffect(t, v => void seen.push(v));
      return d;
    });
    flush();
    let resolve!: () => void;
    const act = action(function* () {
      setS(1);
      yield new Promise<void>(r => (resolve = r));
    });
    act();
    flush();
    await Promise.resolve();

    setS(1);
    setT(5);
    await new Promise(r => setTimeout(r, 0));
    flush();
    expect(seen).toEqual([0]);

    resolve();
    await new Promise(r => setTimeout(r, 0));
    flush();
    expect(seen).toEqual([0, 5]);
    dispose();
  });

  it("a manual flush after the rewrite ends the tick (D-4)", async () => {
    const [s, setS] = createSignal(0);
    const [t, setT] = createSignal(0);
    const seen: number[] = [];
    const dispose = createRoot(d => {
      createEffect(s, () => {});
      createEffect(t, v => void seen.push(v));
      return d;
    });
    flush();
    let resolve!: () => void;
    const act = action(function* () {
      setS(1);
      yield new Promise<void>(r => (resolve = r));
    });
    act();
    flush();
    await Promise.resolve();

    flush(() => setS(1));
    setT(5);
    flush();
    expect(seen).toEqual([0, 5]);

    resolve();
    await new Promise(r => setTimeout(r, 0));
    flush();
    dispose();
  });

  it("an observer rewriting after every flush lets timers run", async () => {
    const [s, setS] = createSignal<number[]>([]);
    const dispose = createRoot(d => {
      createEffect(s, () => {});
      return d;
    });
    flush();
    const next = [1];
    const act = action(function* () {
      setS(next);
      yield new Promise<void>(r => setTimeout(r, 0));
    });
    act();
    flush();

    let rewrites = 0;
    let queued = false;
    DEV!.hooks.onUpdate = () => {
      if (queued || rewrites > 10_000) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        rewrites++;
        setS(s => s);
      });
    };
    setS(s => s);
    await new Promise(r => setTimeout(r, 0));
    flush();
    expect(rewrites).toBeLessThan(10);
    dispose();
  });
});
