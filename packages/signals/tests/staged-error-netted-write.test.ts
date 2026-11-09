/**
 * D-8 + F-9: a tick whose writes net to the committed value made no
 * proposal, so nothing that derives from it pends. Async-gen rerun on next
 * 5e68925c (E2): `m0 = memo(s0 !%4=2)` is errored at `s0 = 1`; `s0 = 2`
 * then an action writing `s0 = 1` in the same tick re-runs `m0`, which
 * throws again. Its pass read the signal's staging — equal to the committed
 * value — so the error was staged and the seam held it with the action
 * (a re-run's error is never equal to the shown one): `isPending(m0)` read
 * `true` for as long as the action stayed open, where an identity memo over
 * it read `false`.
 *
 * The strict form: a labelled `untrack` read takes `read`'s slow path in
 * dev (the fast block tests `strictRead`), where `serve` marked the staged
 * read the fast block skips — dev held what prod did not. The reader-seat
 * shadow's D1'' row (D-8) found it.
 */
import { afterEach, expect, it } from "vitest";
import {
  action,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  resetErrorHalt,
  untrack
} from "../src/index.js";

afterEach(() => resetErrorHalt());

const tick = async () => {
  await new Promise(r => setTimeout(r, 0));
  flush();
};

for (const [identity, strict] of [
  [false, false],
  [true, false],
  [false, true]
])
  it(`writes that net to the committed value pend nothing over an errored memo${identity ? " (through an identity memo)" : ""}${strict ? " (read in a strict untrack)" : ""}`, async () => {
    const [s, setS] = createSignal(1);
    let m!: () => number;
    const seen: boolean[] = [];
    const dispose = createRoot(d => {
      const m0 = createMemo(() => {
        const v = (strict ? (s(), untrack(s, "netted")) : s()) + 1;
        if (v % 4 === 2) throw new Error(`m0:${v}`);
        return v;
      });
      m = identity ? createMemo(() => m0()) : m0;
      createRenderEffect(
        () => isPending(m),
        v => void seen.push(v)
      );
      return d;
    });
    flush();
    const act = action(function* () {
      setS(1);
      yield new Promise(() => {});
    });
    setS(2);
    act();
    await tick();
    expect(seen).toEqual([false]);
    expect(isPending(m)).toBe(false);
    dispose();
  });
