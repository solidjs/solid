/**
 * #4109 follow-up: a pass's own throw is staged whenever a flush is running
 * (D-41). A later pass of the same node in that flush replaces the staging:
 * a value or a pending flight supersedes the staged error, so the commit
 * neither throws the value as an error nor publishes the superseded error.
 */
import { afterEach, expect, it } from "vitest";
import {
  createEffect,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  resetErrorHalt
} from "../src/index.js";

afterEach(() => resetErrorHalt());

const tick = async () => {
  await new Promise(r => setTimeout(r, 0));
  flush();
};

function setup(rerun: (v: number) => number | Promise<number>) {
  const log: unknown[] = [];
  const [s, setS] = createSignal(0);
  const [fix, setFix] = createSignal(false, { ownedWrite: true });
  let m!: () => number;
  const dispose = createRoot(d => {
    m = createMemo(() => {
      const v = s();
      if (v === 1 && !fix()) throw new Error("boom");
      return v === 0 ? 0 : rerun(v);
    });
    // Taller than `m`: seeing s === 1 it writes `fix`, so `m` re-runs in the
    // same flush, after its throw was staged.
    const a = createMemo(() => s() + 1);
    const b = createMemo(() => {
      const x = a();
      if (x === 2) setFix(true);
      return x;
    });
    createEffect(m, {
      effect: v => void log.push(["value", v]),
      error: e => void log.push(["error", (e as any)?.cause?.message ?? (e as any)?.message ?? e])
    });
    createRenderEffect(b, () => {});
    return d;
  });
  flush();
  return { log, setS, read: () => m(), dispose };
}

it("a memo that throws then re-runs to a value in the same flush shows the value", () => {
  const { log, setS, read, dispose } = setup(v => v);
  try {
    setS(1);
    flush();
    flush();
    expect(log).toEqual([
      ["value", 0],
      ["value", 1]
    ]);
    expect(read()).toBe(1);
  } finally {
    dispose();
    flush();
  }
});

it("a memo that throws then re-runs to a pending value does not publish the superseded error", async () => {
  const { log, setS, read, dispose } = setup(v => Promise.resolve(v * 10));
  try {
    setS(1);
    flush();
    await tick();
    await tick();
    expect(log).toEqual([
      ["value", 0],
      ["value", 10]
    ]);
    expect(read()).toBe(10);
  } finally {
    dispose();
    flush();
  }
});
