/**
 * D-41: "A derivation that reads a staged error throws it, as it would read
 * a staged value: its own pass errors and stages with the same frame." Found
 * by the async-gen rerun on next 5e68925c (E2, E3): a memo whose held pass
 * staged an error did not reach its derivations — an identity memo over it
 * kept the old value for `latest()` and read `isPending() === false` for the
 * rest of the hold, while the memo itself threw the proposed error from
 * `latest()` and read pending (D-22, D-23 iii). A staged error now marks its
 * derivations staged with it, as a published error marks them errored.
 */
import { afterEach, expect, it } from "vitest";
import {
  action,
  createEffect,
  createErrorBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest,
  resetErrorHalt
} from "../src/index.js";

afterEach(() => resetErrorHalt());

const tick = async () => {
  await new Promise(r => setTimeout(r, 0));
  flush();
};
const attempt = (fn: () => unknown) => {
  try {
    return fn();
  } catch (e: any) {
    return `throws ${e?.cause?.message ?? e?.message}`;
  }
};

for (const identity of [false, true])
  it(`latest() of a derivation throws the error a held pass staged${identity ? " (identity memo)" : ""}`, async () => {
    const [s, setS] = createSignal(2);
    let m!: () => number;
    let screen: unknown;
    let release!: () => void;
    const dispose = createRoot(d => {
      const m0 = createMemo(() => {
        const v = s() + 1;
        if (v % 4 === 1) throw new Error(`m0:${v}`);
        return v;
      });
      m = identity ? createMemo(() => m0()) : m0;
      const shown = createErrorBoundary(
        () => latest(m),
        e => `E:${(e() as Error).message}`
      );
      createRenderEffect(shown, v => void (screen = v));
      return d;
    });
    flush();
    expect(screen).toBe(3);
    const act = action(function* () {
      setS(0);
      yield new Promise<void>(r => (release = r));
    });
    act();
    await tick();
    // The hold is open: the screen's value is committed, the proposal is
    // the error.
    expect([attempt(() => latest(m)), isPending(m), attempt(() => m())]).toEqual([
      "throws m0:1",
      true,
      3
    ]);
    release();
    await tick();
    await tick();
    expect([attempt(() => m()), isPending(m)]).toEqual(["throws m0:1", false]);
    dispose();
  });

it("isPending of a derivation over an errored memo whose held re-run errors again is true", async () => {
  // m0 = s + 1 (throws at 2 mod 4), m1 = m0 + m0 + 1 (throws at 3 mod 4):
  // errored at s = 0 (m1:3) and again at s = 2 (m1:7).
  const [s, setS] = createSignal(0);
  let m1!: () => number;
  let id!: () => number;
  const seen: boolean[] = [];
  const dispose = createRoot(d => {
    const m0 = createMemo(() => {
      const v = s() + 1;
      if (v % 4 === 2) throw new Error(`m0:${v}`);
      return v;
    });
    m1 = createMemo(() => {
      const v = m0() + m0() + 1;
      if (v % 4 === 3) throw new Error(`m1:${v}`);
      return v;
    });
    id = createMemo(() => m1());
    createRenderEffect(
      () => isPending(id),
      v => void seen.push(v)
    );
    return d;
  });
  flush();
  const act = action(function* () {
    setS(2);
    yield new Promise(() => {});
  });
  act();
  await tick();
  expect([isPending(m1), isPending(id), seen.at(-1)]).toEqual([true, true, true]);
  dispose();
});

it("a derivation's staged error is superseded when its source re-runs to a pending value in the same flush (#4109)", async () => {
  const log: unknown[] = [];
  const [s, setS] = createSignal(0);
  const [fix, setFix] = createSignal(false, { ownedWrite: true });
  let m!: () => number;
  const dispose = createRoot(d => {
    const m0 = createMemo(() => {
      const v = s();
      if (v === 1 && !fix()) throw new Error("boom");
      return v === 0 ? 0 : Promise.resolve(v * 10);
    });
    m = createMemo(() => m0());
    // Taller than `m0`: seeing s === 1 it writes `fix`, so `m0` re-runs in
    // the same flush, after its throw was staged and marked onto `m`.
    const a = createMemo(() => s() + 1);
    const b = createMemo(() => {
      const x = a();
      if (x === 2) setFix(true);
      return x;
    });
    createEffect(m, {
      effect: v => void log.push(["value", v]),
      error: e => void log.push(["error", (e as any)?.cause?.message ?? (e as any)?.message])
    });
    createRenderEffect(b, () => {});
    return d;
  });
  flush();
  setS(1);
  flush();
  await tick();
  await tick();
  expect(log).toEqual([
    ["value", 0],
    ["value", 10]
  ]);
  expect(m()).toBe(10);
  dispose();
});
