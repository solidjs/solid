/**
 * #4089 — a write from a cleanup that a landing's commits run (the old
 * children of a re-run memo die in `land`) to a node the landing still
 * holds joined the landing transaction, which had already left
 * `transactions`. The next flush parked in that dead transaction, and every
 * later transition held its writes there forever. The write is the
 * landing's own: `land` commits the node after it.
 */
import { describe, expect, it } from "vitest";
import {
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  onCleanup
} from "../src/index.js";

const tick = () => new Promise(r => setTimeout(r, 0));

async function run(cleanupWrites: boolean) {
  let release: (() => void) | undefined;
  const [s, setS] = createSignal(0);
  const [v, setV] = createSignal(0, { ownedWrite: true });
  const dispose = createRoot(dispose => {
    const child = createMemo(() => {
      const k = s();
      if (cleanupWrites) createRoot(() => onCleanup(() => setV(x => x + 1)));
      return k;
    });
    const flight = createMemo(async () => {
      const k = s();
      v();
      if (k > 0) await new Promise<void>(r => (release = r));
      return k;
    });
    createRenderEffect(
      () => [child(), flight()],
      () => {}
    );
    return dispose;
  });
  const drain = async () => {
    for (let i = 0; i < 6; i++) {
      release?.();
      await tick();
      flush();
      await tick();
    }
  };
  flush();
  setS(1); // the transition parks on `flight`
  flush();
  await tick();
  setV(10); // `v` joins it (`flight` reads it)
  flush();
  await tick();
  await drain(); // it lands: the old child's cleanup writes `v`
  setS(2); // the next transition
  flush();
  await drain();
  const result = [s(), v()];
  dispose();
  return result;
}

describe("a cleanup write during a landing (#4089)", () => {
  it("lands with the transition, and the next transition still commits", async () => {
    expect(await run(true)).toEqual([2, 12]);
  });

  it("without the cleanup write (baseline)", async () => {
    expect(await run(false)).toEqual([2, 10]);
  });
});
