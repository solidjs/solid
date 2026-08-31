/**
 * #3141: a transaction's ambient window must be one flush.
 *
 * `initTransition` used to leave `activeTransition` (and the adopted batch)
 * armed indefinitely when the transaction was opened without any writes — an
 * action whose first statements only await schedules nothing, so no flush
 * ever parked it. The next unrelated work to arrive was adopted into a
 * transaction it had nothing to do with: an optimistic store's authoritative
 * landing (with its flight still pending, so its live lane was entangled)
 * would not render until the stranger action settled seconds later, an
 * unowned optimistic write rode the same transaction instead of reverting,
 * and deep()/per-key readers split-brained over what "committed" meant
 * meanwhile.
 *
 * The construction here is exact and deterministic:
 *  - the action is invoked in a bare macrotask and performs no writes before
 *    its first await, so pre-fix nothing scheduled a flush and the
 *    transaction stayed ambient;
 *  - the store generator keeps running after the yield (awaiting a further
 *    gate), so the landing arrives on a still-live lane — the entanglement
 *    target. (A generator that ends at the yield resolves its flight and
 *    escapes the capture, which is why simpler distillations don't fail.)
 * No manual flush() between steps — a manual flush parks the transaction and
 * masks the window. The scheduler's own flushing must do the right thing.
 */
import { describe, expect, it } from "vitest";
import {
  action,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  deep,
  flush
} from "../../src/index.js";

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => (resolve = r));
  return { promise, resolve };
}

// A macrotask hop: lets the scheduler's own flush run without forcing one.
const hop = () => new Promise(r => setTimeout(r, 0));

describe("#3141: lingering ambient transaction capture", () => {
  it("an in-flight store landing renders immediately despite an unrelated open action", async () => {
    const stepGate = deferred();
    const endGate = deferred();
    const actGate = deferred();
    const domLog: string[] = [];
    const obsLog: string[] = [];
    let setState!: (fn: (s: number[]) => void) => void;
    let dispose!: () => void;

    const act = action(function* (p: Promise<void>) {
      yield p;
    });

    createRoot(d => {
      dispose = d;
      const [s, ss] = createOptimisticStore<number[]>(
        async function* () {
          yield [1, 2, 3];
          await stepGate.promise;
          yield [3, 2, 1];
          // The flight stays pending past the yield: the landing arrives on a
          // live lane, which is what the lingering transaction entangled.
          await endGate.promise;
        },
        [1, 2]
      );
      setState = ss;

      createRenderEffect(
        () => JSON.stringify(s),
        v => {
          domLog.push(v);
        }
      );
      createRenderEffect(
        () => deep(s),
        v => {
          obsLog.push(JSON.stringify(v));
        }
      );
    });

    await hop();
    expect(domLog.at(-1)).toBe("[1,2,3]");

    // Open the transaction in a bare macrotask: no writes precede its first
    // await, so nothing else will schedule the flush that parks it.
    let acting!: Promise<unknown>;
    setTimeout(() => {
      acting = act(actGate.promise);
    }, 0);
    await hop();
    await hop();

    // The store's own truth lands mid-action: it must render now — not when
    // the unrelated action settles — and both reader families must agree.
    stepGate.resolve();
    await hop();
    await hop();
    expect(domLog.at(-1)).toBe("[3,2,1]");
    expect(obsLog.at(-1)).toBe("[3,2,1]");

    // An unowned optimistic push composes over the CURRENT base and, with no
    // transaction of its own, reverts at the flush — it must not be adopted
    // by the open action and persist until that action settles.
    setState(draft => {
      draft.push(1111);
    });
    await hop();
    expect(domLog.at(-1)).toBe("[3,2,1]");
    expect(obsLog.at(-1)).toBe("[3,2,1]");
    expect(domLog).not.toContain("[1,2,3,1111]"); // the split-brain composition

    // At no point may the two reader families disagree about the value. The
    // observer may legitimately fire more often (its initial run doubles), so
    // compare deduped value sequences: pre-fix the DOM showed [1,2,3,1111]
    // while deep() reported [3,2,1,1111].
    const dedupe = (log: string[]) => log.filter((v, i) => v !== log[i - 1]);
    expect(dedupe(obsLog)).toEqual(dedupe(domLog));

    actGate.resolve();
    await acting;
    await hop();
    expect(domLog.at(-1)).toBe("[3,2,1]");

    endGate.resolve();
    await hop();
    dispose();
    flush();
  });
});
