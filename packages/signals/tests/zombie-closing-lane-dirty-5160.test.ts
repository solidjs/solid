// #5160: A zombie whose nearest non-zombie owner is closing unheld (either
// mainline after `keepReaders` cleared CONFIG_HELD, or inside a lane) must be
// deferred/skipped until commit or lane settlement disposes it, never
// recomputed eagerly with a lane-dirty read on the closing branch.

import { afterEach, describe, expect, it } from "vitest";
import {
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  latest
} from "../src/index.js";

afterEach(() => flush());

const tick = async (n = 12) => {
  for (let i = 0; i < n; i++) await Promise.resolve();
  flush();
};

function narrowedGateHarness(slowBelowWhen: boolean, sync = true) {
  let setId!: (v: number) => void;
  let resolveSlow!: (v: string) => void;
  const seenChild: string[] = [];
  const seenOut: unknown[] = [];

  const dispose = createRoot(d => {
    const [id, _setId] = createSignal(1);
    setId = _setId;

    const data = createMemo(() =>
      id() === 1
        ? { status: "modelFailed", reason: "boom" as string | undefined }
        : { status: "running", reason: undefined as string | undefined }
    );
    const slow = createMemo(() =>
      id() === 1 ? "ok-1" : new Promise<string>(r => (resolveSlow = r))
    );

    if (slowBelowWhen) createRenderEffect(slow, () => {});

    const when = slowBelowWhen
      ? (() => {
          const m1 = createMemo(() => latest(data).reason);
          return createMemo(() => m1());
        })()
      : createMemo(() => latest(data).reason);

    const condition = createMemo(when, { equals: (a, b) => !a === !b });
    const value = createMemo(() => {
      if (!condition()) return () => "fallback";
      const narrowed = () => {
        if (!condition()) throw new Error("stale read from closing branch");
        return when();
      };
      const child = createMemo(() => `${latest(data).status}/${narrowed()}`, { sync });
      createRenderEffect(child, v => void seenChild.push(v));
      return () => child();
    });

    createRenderEffect(
      () => value()(),
      v => void seenOut.push(v)
    );
    if (!slowBelowWhen) createRenderEffect(slow, () => {});
    return d;
  });

  return {
    setId,
    resolveSlow: (v: string) => resolveSlow(v),
    seenChild,
    seenOut,
    dispose
  };
}

describe("#5160 closing zombie with lane-dirty dep while sibling flight holds", () => {
  for (const sync of [true, false]) {
    it(`defers a lane-dirty zombie when keepReaders unholds its closing mainline owner (sync: ${sync})`, async () => {
      const h = narrowedGateHarness(false, sync);
      try {
        flush();
        await tick();
        expect(h.seenChild).toEqual(["modelFailed/boom"]);
        expect(h.seenOut).toEqual(["modelFailed/boom"]);

        h.setId(2);
        flush();
        await tick();
        expect(h.seenOut).toEqual(["modelFailed/boom", "fallback"]);
        expect(h.seenChild).toEqual(["modelFailed/boom"]);

        h.resolveSlow("ok-2");
        flush();
        await tick();
        expect(h.seenOut).toEqual(["modelFailed/boom", "fallback"]);
      } finally {
        h.dispose();
      }
    });
  }

  it("skips a lane-owned zombie in deferredZombies when its owner closes on the verdict lane", async () => {
    const h = narrowedGateHarness(true, true);
    try {
      flush();
      await tick();
      expect(h.seenChild).toEqual(["modelFailed/boom"]);

      h.setId(2);
      flush();
      await tick();
      expect(h.seenOut).toEqual(["modelFailed/boom", "fallback"]);
      expect(h.seenChild).toEqual(["modelFailed/boom"]);

      h.resolveSlow("ok-2");
      flush();
      await tick();
      expect(h.seenOut).toEqual(["modelFailed/boom", "fallback"]);
    } finally {
      h.dispose();
    }
  });
});
