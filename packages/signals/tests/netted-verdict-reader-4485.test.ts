// #4485 (it.fails pin): writes that net to a signal's committed value in the
// tick an action opens a hold made no proposal (D-8), so a verdict reader of
// the signal shows `isPending(s)` false and is not re-run at the landing.
// Today it shows `true` for the whole hold and re-runs at the landing: the
// reader takes the seat table's `stagedScreen` row before any netted check,
// which lists it as a stale reader of the flush's hold (D-23 Status, #4469's
// family).
import { describe, expect, it } from "vitest";
import {
  action,
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

describe("#4485: a verdict reader of a signal whose writes net", () => {
  const net = async (where: "in-action" | "before-action" | "later-tick") => {
    const [s, setS] = createSignal(1);
    const [x, setX] = createSignal(0);
    const runs: unknown[] = [];
    const dispose = createRoot(d => {
      createRenderEffect(x, () => {});
      createRenderEffect(
        () => [s(), isPending(s)],
        v => void runs.push(v)
      );
      return d;
    });
    flush();
    runs.length = 0;
    if (where === "before-action") (setS(2), setS(1));
    let release!: () => void;
    action(function* () {
      setX(1);
      if (where === "in-action") (setS(2), setS(1));
      yield new Promise<void>(r => (release = r));
    })();
    if (where === "later-tick") {
      await tick();
      setS(2);
      setS(1);
    }
    await tick();
    const held = runs.slice();
    release();
    await tick();
    await tick();
    dispose();
    return { held, runs };
  };

  it.fails.each(["in-action", "before-action"] as const)(
    "pends nothing and is not re-run at the landing (%s)",
    async where => {
      const { held, runs } = await net(where);
      expect(held).toEqual([[1, false]]);
      expect(runs).toEqual([[1, false]]);
    }
  );

  it("pends nothing in a later tick of the hold", async () => {
    const { runs } = await net("later-tick");
    expect(runs).toEqual([[1, false]]);
  });
});
