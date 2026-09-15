/**
 * A29, creation-time form — "born held".
 *
 * A memo or effect created from MAINLINE code while a transaction holds a
 * value it reads (a component mounting on a click while an action is in
 * flight) is served the staged value and derives from the transaction's
 * world. Its result is the transaction's: staged into it, committed with it,
 * and — for an effect — first run by its commit. Nothing about the mainline
 * block that created it changes: `activeTransition` and the ambient batch are
 * untouched, so a write made after the mount is a mainline write.
 *
 * Before: recompute's creation pass always direct-committed, so the fresh
 * memo published the held value into the mainline frame beside pre-existing
 * readers showing the committed one; and enterStagedRead entered the
 * transaction ambiently, so an unrelated write made after the mount was
 * swallowed into the action.
 */
import { describe, expect, it } from "vitest";
import {
  NotReadyError,
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

describe("A29 born held: nodes created mainline during a hold", () => {
  it("a fresh memo + render effect derive from the held world and are held with it; a fresh direct effect shows the committed frame", async () => {
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
    // The memo's pass derived from the staged 1 (A29) ...
    expect(derived).toEqual([1]);
    // ... and its effect published nothing: the value is the transaction's.
    expect(viaMemo).toEqual([]);
    // The direct effect is a stale reader of a parallel transaction: committed.
    expect(direct).toEqual([0]);
    expect(pre).toEqual([0]);

    release();
    await settle();
    // The commit reveals everything at once.
    expect(viaMemo).toEqual([1]);
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

  it("an untracked read of a born-held memo has no committed value to serve and throws NotReady until the commit", async () => {
    const { x, release } = heldSignal();
    let m!: () => number;
    createRoot(() => {
      m = createMemo(() => x());
    });
    expect(() => m()).toThrow(NotReadyError);
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
