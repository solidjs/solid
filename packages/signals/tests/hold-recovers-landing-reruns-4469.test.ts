// #4469: a hold whose staged error recovers to the committed value. An action
// makes `m0` throw (staged with the hold, D-41), then writes it back to its
// committed value, and the hold commits later.
//
// A plain reader (`value`) shows the committed value for the whole hold and
// runs once, at the commit. That is the ruled screen: "a recovery to a value
// equal to the last good one is still a change of answer" (D-41), and the
// reader settles with the hold it shares (D-9).
//
// A verdict reader (`pending`, `both`) runs while the error is staged and
// again at the recovery, both right, then a third time when the hold
// commits, though nothing it read changed. The landing's re-derivation
// (`reruns`) re-runs every stale and verdict reader of the hold (A15). That
// is a known deviation under D-23's Status, pinned it.fails here.
import { describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending
} from "../src/index.js";

const tick = async () => {
  await new Promise(r => setTimeout(r, 0));
  flush();
};

describe("#4469: a hold that recovers to the committed value", () => {
  const recover = async (read: "value" | "pending" | "both") => {
    const [s, setS] = createSignal(0);
    const runs: unknown[] = [];
    const dispose = createRoot(d => {
      const m0 = createMemo(() => {
        if (s() === 2) throw new Error("two");
        return 30 + s() * 5;
      });
      createRenderEffect(
        () =>
          read === "value" ? [m0()] : read === "pending" ? [isPending(m0)] : [m0(), isPending(m0)],
        v => void runs.push(v)
      );
      return d;
    });
    flush();
    runs.length = 0;
    let r1!: () => void, r2!: () => void;
    action(function* () {
      setS(2);
      yield new Promise<void>(r => (r1 = r));
      setS(0);
      yield new Promise<void>(r => (r2 = r));
    })();
    await tick();
    const held = runs.length;
    r1();
    await tick();
    const recovered = runs.length;
    r2();
    await tick();
    await tick();
    dispose();
    return { held, recovered, committed: runs.length, runs };
  };

  it("runs a plain reader once, at the commit (value; D-41, D-9)", async () => {
    const { held, recovered, runs } = await recover("value");
    expect(held).toBe(0);
    expect(recovered).toBe(0);
    expect(runs).toEqual([[30]]);
  });

  it.fails.each(["pending", "both"] as const)(
    "re-runs no reader at the landing (%s)",
    async read => {
      const { recovered, committed } = await recover(read);
      expect(committed).toBe(recovered);
    }
  );

  it("runs the reader while staged and at the recovery (both)", async () => {
    const { runs } = await recover("both");
    expect(runs.slice(0, 2)).toEqual([
      [30, true],
      [30, false]
    ]);
  });
});
