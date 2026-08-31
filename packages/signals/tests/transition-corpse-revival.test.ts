/**
 * #3140: a `_transition` stamp must not outlive its transaction.
 *
 * `commitPendingNode` committed the value but left `_transition` pointing at
 * the finished transaction (optimistic stamps were cleared at completion;
 * pending stamps were not). `setSignal` re-opens a node's stamped transaction
 * BEFORE the value-equal bail, so a later no-op write resurrected the corpse:
 * the drain loop saw a live transition again, completed it, and the next
 * finalize pass (a Loading boundary's `_checkSources` rewrites its flag with
 * the same value on every pass) revived it again — the dev build threw the
 * flush loop guard, production hung the tab.
 *
 * The wild stamping race did not reduce to a minimal reproduction (see the
 * issue), so each layer is pinned directly:
 *  - commit clears the stamp (symmetry with resolveOptimisticNodes);
 *  - a write finding a dead stamp — however it survived — must not
 *    re-activate the finished transaction.
 */
import { describe, expect, it } from "vitest";
import { action, createSignal, flush } from "../src/index.js";
import { createRoot } from "../src/index.js";
import { setSignal, signal, type Signal } from "../src/core/index.js";
import { activeTransition, type Transition } from "../src/core/scheduler.js";

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => (resolve = r));
  return { promise, resolve };
}

/** Runs an action to completion and returns its (now finished) transaction. */
async function completedTransition(): Promise<Transition> {
  const gate = deferred();
  let captured: Transition | null = null;
  let start!: () => Promise<unknown>;
  createRoot(() => {
    start = action(function* () {
      captured = activeTransition;
      yield gate.promise;
    });
  });
  const acting = start();
  flush();
  gate.resolve();
  await acting;
  await new Promise(r => setTimeout(r, 0));
  flush();
  expect(captured).not.toBeNull();
  expect((captured as unknown as Transition)._done).toBe(true);
  return captured as unknown as Transition;
}

describe("#3140: completed-transaction stamps", () => {
  it("commit clears the pending stamp", async () => {
    const gate = deferred();
    let start!: () => Promise<unknown>;
    createRoot(() => {
      start = action(function* () {
        yield gate.promise;
      });
    });

    const node = signal(1) as Signal<number>;
    // Stage the write in the ambient batch, then open the transaction in the
    // same unflushed window: initTransition's batch adoption stamps every
    // staged node with it.
    setSignal(node, 2);
    const acting = start();
    expect(node._transition).not.toBeNull();

    // Park (incomplete: the action is awaiting), then complete.
    flush();
    gate.resolve();
    await acting;
    await new Promise(r => setTimeout(r, 0));
    flush();

    expect(node._value).toBe(2);
    // Pre-fix the stamp survived the commit, pointing at a done transaction.
    expect(node._transition).toBeNull();
  });

  it("a value-equal write to a dead-stamped node does not resurrect the transaction", async () => {
    const dead = await completedTransition();

    // However a dead stamp survives (the wild race did not minimize), the
    // write path must refuse the corpse rather than re-activate it.
    const node = signal(5) as Signal<number>;
    node._transition = dead;

    setSignal(node, 5); // value-equal: bails after the transition re-open ran
    // Pre-fix: activeTransition === dead here, and every drain-loop pass that
    // rewrote any stamped flag re-armed it — the infinite flush loop.
    expect(activeTransition).toBeNull();
    flush();
    expect(activeTransition).toBeNull();

    // A real write is routed to the ambient batch, not the corpse.
    const [, setTick] = createSignal(0);
    setSignal(node, 6);
    setTick(1);
    expect(activeTransition).toBeNull();
    flush();
    expect(node._value).toBe(6);
  });
});
