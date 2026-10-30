/**
 * #4467. A Loading mounted during an action's hold by a memo that read the
 * held `x` (it joins: born held, D-2). The fallback returns a function, and
 * the mount calls it in its own pass. Content lands (50 ms) before the
 * action (200 ms).
 *
 * When the function reads `latest(x)` (directly, or through a memo the
 * fallback built), the mount's pass probes: it keeps CONFIG_VERDICT (D-25,
 * the posture outlives the pass). At the content's landing the mount
 * re-runs — still born into the hold, never committed — and recompute's
 * held re-pass did not join the flush to the hold for a verdict reader. So
 * the boundary the re-run mounts was not the hold's (D-13): it caught its own
 * born-held tree and showed the fallback; the tree then read the landed
 * content, the output changed, the mount re-ran and mounted another boundary,
 * without end. A pass born in the hold's world is the hold's own work and
 * reads plainly whatever it asked before (D-25, D-27 #4341): it joins.
 *
 * The string-returning forms (`direct`, `innerMemo`) read `latest` only in the
 * fallback's own computed (#4337), never in the mount's pass.
 */
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  action,
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  latest,
  untrack
} from "../src/index.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

for (const v of ["direct", "innerMemo", "fnDirect", "fnMemo"] as const)
  test(`fallback ${v} under a mount that joined the hold settles on 1:C`, async () => {
    const [x, setX] = createSignal(0);
    createRoot(() => createRenderEffect(x, () => {}));
    flush();
    action(function* () {
      setX(1);
      yield sleep(200);
    })();
    flush();
    let builds = 0;
    const screens: unknown[] = [];
    createRoot(() => {
      const content = createMemo(async () => {
        await sleep(50);
        return "C";
      });
      const mount = createMemo(() => {
        const v0 = x();
        const b = untrack(() =>
          createLoadingBoundary(
            () => content(),
            () => {
              builds++;
              if (builds > 50) throw new Error("runaway fallback rebuild");
              if (v === "direct") return `F${latest(x)}`;
              if (v === "fnDirect") return () => `F${latest(x)}`;
              const t = createMemo(() => latest(x));
              if (v === "fnMemo") return () => `F${t()}`;
              return `F${t()}`;
            }
          )
        );
        const r: any = b();
        return `${v0}:${typeof r === "function" ? r() : r}`;
      });
      createRenderEffect(mount, s => void screens.push(s));
    });
    flush();
    await vi.advanceTimersByTimeAsync(100);
    flush();
    await vi.advanceTimersByTimeAsync(200);
    flush();
    expect(builds).toBe(1);
    expect(screens).toEqual(["1:C"]);
  });
