/**
 * #3140: a hold stamp must not outlive its transaction.
 *
 * Under `next`, `commitPendingNode` committed the value but left
 * `_transition` pointing at the finished transaction; a later value-equal
 * write re-opened the corpse before the equality bail, the drain loop saw a
 * live transition again, and a boundary re-writing its flag with the same
 * value every pass revived it forever (dev: the flush loop guard; prod: a
 * hung tab).
 *
 * L2's equivalents, pinned directly:
 *  - the landing clears the node's transaction (`land`: the held node is
 *    the transaction's to commit, and the stamp goes with the commit);
 *  - a write to a node whose action has landed — value-equal or not — opens
 *    no transaction and holds nothing: the flush terminates and the value
 *    commits mainline.
 */
import { describe, expect, it } from "vitest";
import { action, createRenderEffect, createSignal, flush } from "../src/index.js";
import { createRoot } from "../src/index.js";
import { setSignal, signal, type Signal } from "../src/core/index.js";
import { CONFIG_HELD } from "../src/core/constants.js";

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => (resolve = r));
  return { promise, resolve };
}

describe("#3140: completed-transaction stamps", () => {
  it("the landing clears the held node's transaction", async () => {
    const gate = deferred();
    const node = signal(1) as Signal<number>;
    let start!: () => Promise<unknown>;
    createRoot(() => {
      start = action(function* () {
        setSignal(node, 2);
        yield gate.promise;
      });
    });
    const acting = start();
    flush();
    // Parked: held by the action's transaction.
    expect(node._config & CONFIG_HELD).toBeTruthy();
    expect(node._x?._transaction).not.toBeNull();
    expect(node._value).toBe(1);

    gate.resolve();
    await acting;
    await new Promise(r => setTimeout(r, 0));
    flush();

    expect(node._value).toBe(2);
    // The stamp went with the commit: no dead transaction on the node.
    expect(node._config & CONFIG_HELD).toBe(0);
    expect(node._x?._transaction ?? null).toBeNull();
  });

  it("a write to a node whose action has landed holds nothing and terminates", async () => {
    const gate = deferred();
    const node = signal(5) as Signal<number>;
    const rendered: number[] = [];
    let start!: () => Promise<unknown>;
    const dispose = createRoot(d => {
      createRenderEffect(
        () => node._value,
        () => {}
      );
      start = action(function* () {
        setSignal(node, 5); // value-equal inside the action: no proposal (A34)
        yield gate.promise;
      });
      return d;
    });
    const acting = start();
    flush();
    gate.resolve();
    await acting;
    await new Promise(r => setTimeout(r, 0));
    flush();
    expect(node._x?._transaction ?? null).toBeNull();

    // Value-equal after the landing: nothing re-opens, nothing holds.
    setSignal(node, 5);
    flush();
    expect(node._config & CONFIG_HELD).toBe(0);
    expect(node._value).toBe(5);

    // A real write commits mainline, in its own tick's flush.
    const [tick, setTick] = createSignal(0);
    createRoot(() => createRenderEffect(tick, v => void rendered.push(v)));
    flush();
    setSignal(node, 6);
    setTick(1);
    flush();
    expect(node._value).toBe(6);
    expect(node._config & CONFIG_HELD).toBe(0);
    expect(rendered).toEqual([0, 1]);
    dispose();
  });
});
