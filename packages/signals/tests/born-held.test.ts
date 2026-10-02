/** Mainline mounts publish a committed first frame, then let the foreign
 * transaction prepare and hold its continuation. Existing memo reruns and
 * computations created inside actions retain A29's entanglement policy. */
import { describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush
} from "../src/index.js";

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  flush();
};

function heldSignal() {
  const [x, setX] = createSignal(0);
  const pre: number[] = [];
  createRoot(() => {
    createRenderEffect(x, v => {
      pre.push(v);
    });
  });
  flush();
  let release!: () => void;
  const run = action(function* () {
    setX(1);
    yield new Promise<void>(r => (release = r));
  });
  run();
  flush();
  return { x, pre, release };
}

describe("mainline mount seams during a hold", () => {
  it("a fresh memo and a direct render effect both publish committed values before the reveal", async () => {
    const { x, pre, release } = heldSignal();
    expect(pre).toEqual([0]);

    const viaMemo: number[] = [];
    const direct: number[] = [];
    const derived: number[] = [];
    createRoot(() => {
      const m = createMemo(() => {
        const v = x();
        derived.push(v);
        return v;
      });
      createRenderEffect(m, v => {
        viaMemo.push(v);
      });
      createRenderEffect(x, v => {
        direct.push(v);
      });
    });
    flush();
    // Publish the first frame, then prepare the foreign continuation.
    expect(derived).toEqual([0, 1]);
    expect(viaMemo).toEqual([0]);
    // The direct effect is a stale reader of a parallel transaction: committed.
    expect(direct).toEqual([0]);
    expect(pre).toEqual([0]);

    release();
    await settle();
    // The commit reveals everything at once.
    expect(viaMemo).toEqual([0, 1]);
    expect(direct).toEqual([0, 1]);
    expect(pre).toEqual([0, 1]);
  });

  it("an unrelated mainline write after the mount is not swallowed into the action", async () => {
    const { x, release } = heldSignal();
    const [y, setY] = createSignal(0);
    const yLog: number[] = [];
    createRoot(() => {
      createRenderEffect(y, v => {
        yLog.push(v);
      });
    });
    flush();
    yLog.length = 0;

    // click handler: mount something that reads the held x, then an unrelated write
    createRoot(() => {
      createMemo(() => x());
    });
    setY(1);
    flush();
    expect(yLog).toEqual([1]);
    expect(y()).toBe(1);

    release();
    await settle();
  });

  it("an untracked read of a fresh memo serves its committed first frame during the hold", async () => {
    const { x, release } = heldSignal();
    let m!: () => number;
    createRoot(() => {
      m = createMemo(() => x());
    });
    expect(m()).toBe(0);
    release();
    await settle();
    expect(m()).toBe(1);
  });

  it("inside a flush nothing changes: a memo whose branch flips mainline still enters (#3408)", async () => {
    const { x, release } = heldSignal();
    const [fixed, setFixed] = createSignal(true);
    const log: string[] = [];
    createRoot(() => {
      const sel = createMemo(() => (fixed() ? -1 : x()));
      createRenderEffect(sel, v => {
        log.push(`sel:${v}`);
      });
    });
    flush();
    expect(log).toEqual(["sel:-1"]);
    setFixed(false); // mainline flip → the pass reads the held x → enters the transaction
    flush();
    expect(log).toEqual(["sel:-1"]);
    release();
    await settle();
    expect(log).toEqual(["sel:-1", "sel:1"]);
  });
});
