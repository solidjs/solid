/**
 * A projection's leaf companions die with the projection (spec O5).
 *
 * Was: with a projection store's refetch held and a `latest()` companion
 * created on a leaf, the synchronous flush right after `dispose()` tripped
 * the __TEST__ quiescence invariant INV-4. The leaf's shadow had never
 * derived a value — its compute reads through a projection in flight, so the
 * backfilled override stood in — and the settle after disposal dropped the
 * override, leaving a shadow that is NotReady/uninitialized forever against a
 * leaf whose committed value is 0. Externally coherent (`latest()` fell back
 * to the committed value), but a companion outliving its source is what
 * INV-9's rationale forbids. Now `disposeChildren(self)` retires the
 * companions of the firewall's `_companionChildren`: the shadow is disposed
 * (a later read recreates it from the committed view), the isPending signal
 * snaps. And `latest()` of a leaf whose firewall is already disposed serves
 * the committed value without creating a shadow — a boundary's content
 * re-running after the teardown recreated one that no teardown would retire.
 * Surfaced when #3495 / O3 stopped leaking the parked transactions that had
 * masked every quiescence check in the posture matrix.
 *
 * Own file: a live action in a sibling test would mask the check.
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

it("the flush right after disposing a projection with a held refetch passes the quiescence invariants (INV-4)", async () => {
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
  expect(() => flush()).not.toThrow(); // INV-4 here before the fix
  // A latest() read AFTER the disposal (a boundary's content re-running, a
  // stale handler) must not recreate a shadow on the dead leaf — nothing
  // would ever retire it. It serves the committed value and creates nothing.
  expect(latest(() => s.n)).toBe(s.n);
  const [, poke] = createSignal(0);
  poke(1);
  expect(() => flush()).not.toThrow(); // the recreated shadow tripped INV-4 here
});
