/**
 * #4145: a memo throws while an async sibling holds the frame (D-41 stages
 * the error), then recomputes successfully before that frame commits. The
 * success replaces the proposal: when the sibling lands, the frame shows the
 * recovered value — it is not thrown as the error it replaced.
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => (resolve = res));
  return { promise, resolve };
}
// Before the fix the reveal halts the reactive system; keep the cases apart.
afterEach(() => resetErrorHalt());

const tick = async () => {
  await new Promise(r => setTimeout(r, 0));
  flush();
};

it.each([1, 7])(
  "a held error replaced by a value (%s) before its frame commits shows the value",
  async recovered => {
    const request = deferred<number>();
    const boom = new Error("boom");
    const [step, setStep] = createSignal(0);
    const seen: unknown[] = [];
    const errors: unknown[] = [];
    let value!: () => number;
    const dispose = createRoot(d => {
      const slow = createMemo(() => (step() === 0 ? 1 : request.promise));
      value = createMemo(() => {
        const s = step();
        if (s === 1) throw boom;
        return s === 0 ? 1 : recovered;
      });
      const sum = createMemo(() => slow() + value());
      createRenderEffect(sum, v => void seen.push(v), { schedule: true });
      createEffect(sum, { effect: () => {}, error: e => void errors.push(e) });
      return d;
    });
    try {
      flush();
      expect(seen).toEqual([2]);

      // `slow` holds the frame; `value`'s error is staged behind it.
      setStep(1);
      flush();
      expect(seen).toEqual([2]);

      // `value` recovers while the request is still pending.
      setStep(2);
      flush();
      expect(seen).toEqual([2]);

      request.resolve(2);
      await tick();
      expect(errors).toEqual([]);
      expect(seen).toEqual([2, 2 + recovered]);
      expect(value()).toBe(recovered);
    } finally {
      dispose();
      flush();
    }
  }
);
