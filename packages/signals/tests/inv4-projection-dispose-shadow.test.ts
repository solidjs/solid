/**
 * INV-4 after disposing a projection mid-refetch — VIOLATION, pinned it.fails
 * (spec O5; posture matrix S3).
 *
 * Reproduces on `next`: with a projection store's refetch held and a
 * `latest()` companion created on a leaf, the synchronous flush right after
 * `dispose()` trips the __TEST__ quiescence invariant INV-4 ("latest() shadow
 * holds a stale committed value for a settled node"). Externally the leaf and
 * its shadow agree throughout (`s.n` and `latest(() => s.n)` both read the
 * committed 0), so the stale pair is an INTERNAL companion owner — the
 * projection's firewall node is the candidate — and the window closes a
 * microtask later. Under __TEST__ the runtime's own scheduled flush throws in
 * that window and leaves the scheduler mid-flush, which is what poisoned the
 * posture matrix once #3488 / O3 stopped leaking the parked transactions that
 * had kept `transitions.size > 0` and silenced every quiescence check.
 *
 * Own file: a live action in a sibling test would mask the check the same way.
 */
import { expect, it } from "vitest";
import {
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  latest
} from "../src/index.js";

it.fails(
  "the flush right after disposing a projection with a held refetch passes the quiescence invariants (INV-4)",
  async () => {
    const [q, setQ] = createSignal(0);
    const fetches: Array<() => void> = [];
    let s!: { n: number };
    const dispose = createRoot(d => {
      [s] = createStore<{ n: number }>(
        () => {
          const v = q();
          return new Promise(r => fetches.push(() => r({ n: v * 10 })));
        },
        { n: -1 }
      );
      createRenderEffect(
        () => s.n,
        () => {}
      );
      return d;
    });
    flush();
    fetches.shift()!();
    for (let i = 0; i < 3; i++) {
      await new Promise(r => setTimeout(r, 0));
      flush();
    }
    setQ(1); // refetch, never lands
    flush();
    expect(latest(() => s.n)).toBe(0); // creates the leaf's companion
    dispose();
    expect(() => flush()).not.toThrow(); // INV-4 here on next
    expect(latest(() => s.n)).toBe(s.n); // (externally the two agree — the stale pair is internal)
  }
);
