/**
 * #2963 — ambient writes must not go stale under verdict-companion lanes.
 *
 * An isPending() companion is an optimistic signal, so its flip puts
 * downstream render effects "under an optimistic lane". laneReadsCommitted
 * serves those effects the committed view of plain nodes — correct for
 * transaction-held writes (transaction completion re-delivers), but an
 * ambient same-tick write commits at flush end with no re-delivery. The fix
 * records such readers on the batch and replays them at commit (initTransition
 * carries the recording into a transaction if one forms mid-flush).
 */
import { describe, expect, test } from "vitest";
import {
  createSignal,
  createMemo,
  createRenderEffect,
  createRoot,
  isPending,
  flush
} from "../src/index.js";

function setup(useIsPending: boolean) {
  const [state, setState] = createSignal<any>({});
  const effectLog: string[] = [];

  createRoot(() => {
    // Mirrors <Show when={isPending(state) || !!state().token}> next to a
    // sibling <Show when={state().data}> hosted in a fragment.
    const whenA = createMemo(() =>
      useIsPending ? isPending(state) || !!state().token : !!state().token
    );
    const whenB = createMemo(() => state().data);
    const outA = createMemo(() => (whenA() ? "submitting" : ""));
    const outB = createMemo(() => (whenB() ? `result:${whenB()}` : ""));
    createRenderEffect(
      () => `${outA()}|${outB()}`,
      v => {
        effectLog.push(v);
      }
    );
  });
  flush();
  return { setState, effectLog };
}

describe("ambient write replay under companion lanes (#2963)", () => {
  test("write following an isPending-true tick lands the same flush", () => {
    const { setState, effectLog } = setup(true);

    // Tick A: the write makes isPending(state) true for the tick, so the
    // companion (an optimistic node) flips and the effect runs under a lane.
    setState({ token: "tok" });
    flush();
    expect(effectLog.at(-1)).toBe("submitting|");

    // Tick B: unrelated ambient write. Without replay the effect reads the
    // committed (old) view and the update is lost until the next write.
    setState({ data: "ok" });
    flush();
    expect(effectLog.at(-1)).toBe("|result:ok");
  });

  test("raw thenable values in state don't change the outcome", () => {
    const { setState, effectLog } = setup(true);

    setState({ token: Promise.resolve("ignored") });
    flush();
    expect(effectLog.at(-1)).toBe("submitting|");

    setState({ data: "ok" });
    flush();
    expect(effectLog.at(-1)).toBe("|result:ok");
  });

  test("control: without isPending there is no lane and no staleness", () => {
    const { setState, effectLog } = setup(false);

    setState({ token: "tok" });
    flush();
    expect(effectLog.at(-1)).toBe("submitting|");

    setState({ data: "ok" });
    flush();
    expect(effectLog.at(-1)).toBe("|result:ok");
  });
});
