/**
 * A woken parked transaction must not re-enter over a staged ambient bump
 * (matrix finding F6, optimistic-list-mutation-matrix.test.ts).
 *
 * The flush re-enters a transaction that `wakeParked()` queued only on an
 * idle pass, because entering adopts the ambient batch. "Idle" was judged
 * by `scheduled` — an empty dirty heap and no active transaction — which
 * misses a write staged in the ambient batch with NO subscriber: the keyset
 * bump `_clearOptimisticStores` writes at an optimistic store's settle is
 * one when nothing tracks the store's key set (a `repeat` over `length`, a
 * plain `length` effect). The re-entered transaction adopted the bump,
 * parked again and left it stamped; the next structural write to the store
 * — an ambient probe push — then joined that FOREIGN hold as a second
 * proposal on a contested node (A34, `batchJoins`) and its override never
 * reverted. The fast drain already tests `_pendingNodes` before it commits
 * ambient work; the wake now uses the same idle test.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  action,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  resetErrorHalt,
  untrack
} from "../../src/index.js";

interface Row {
  id: string;
}
const rows = (ids: string): Row[] => ids.split("").map(id => ({ id }));
const ids = (l: readonly Row[]) => l.map(r => r.id).join("");
const tick = () => new Promise<void>(r => setTimeout(r, 0));
const gate = () => {
  let release!: () => void;
  const promise = new Promise<void>(r => (release = r));
  return { promise, release };
};
async function settle(done: Promise<unknown>) {
  flush();
  await Promise.race([
    done,
    (async () => {
      for (let i = 0; i < 10; i++) await tick();
    })()
  ]);
  flush();
  await tick();
  flush();
}

afterEach(() => {
  resetErrorHalt();
  flush();
});

describe("woken parked transaction vs a staged ambient bump", () => {
  function fixture() {
    let view!: Row[], setView!: (fn: (d: Row[]) => void) => void;
    let setTruth!: (fn: (prev: Row[]) => Row[]) => void;
    let setFlag!: (v: boolean) => void;
    const lengths: number[] = [];
    const dispose = createRoot(d => {
      const [truth, st] = createSignal<Row[]>(rows("abc"));
      setTruth = st as typeof setTruth;
      [view, setView] = createOptimisticStore<Row[]>(() => truth(), []);
      // The store's only reader tracks `length`, never the key set: the
      // settle's keyset bump is staged with no subscriber.
      createRenderEffect(
        () => view.length,
        n => void lengths.push(n)
      );
      // An effect that drops a dependency when `flag` flips: that pass calls
      // `wakeParked()` (a reporter may have stopped counting), queueing
      // every parked transaction for an idle re-entry.
      const [flag, sf] = createSignal(true);
      setFlag = sf;
      const [x] = createSignal(0);
      createRenderEffect(
        () => (flag() ? x() : 0),
        () => {}
      );
      return d;
    });
    flush();
    return { view, setView, setTruth, setFlag, lengths, dispose };
  }

  it("an ambient probe write after a settle reverts at its flush while an unrelated action stays parked", async () => {
    const f = fixture();
    // A: an unrelated action that never settles — its transaction parks.
    const ga = gate();
    const parked = action(function* () {
      yield ga.promise;
    });
    const doneA = parked();
    flush();
    // B: an optimistic push on the store, confirmed by the truth. Its body
    // also flips `flag`, so the settle's pass drops a dependency and wakes
    // A with the keyset bump still staged in the ambient batch.
    const gb = gate();
    const push = action(function* () {
      f.setView(d => void d.push({ id: "x" }));
      yield gb.promise;
      f.setFlag(false);
      f.setTruth(prev => [...prev, { id: "x" }]);
    });
    const doneB = push();
    flush();
    expect(untrack(() => ids(f.view))).toBe("abcx");
    gb.release();
    await settle(doneB);
    expect(untrack(() => ids(f.view))).toBe("abcx");
    expect(f.lengths.at(-1)).toBe(4);

    // The probe: an ambient optimistic write is visible only at the flush
    // that carries it and reverts with it (A28 (5)). Adopted into A's hold
    // it would stay.
    f.setView(d => void d.push({ id: "p" }));
    flush();
    expect(untrack(() => ids(f.view))).toBe("abcx");
    expect(f.lengths.at(-1)).toBe(4);

    // A probe ACTION reverts at its own end, not at A's.
    const gc = gate();
    const probe = action(function* () {
      f.setView(d => void d.push({ id: "q" }));
      yield gc.promise;
    });
    const doneC = probe();
    flush();
    expect(untrack(() => ids(f.view))).toBe("abcxq");
    gc.release();
    await settle(doneC);
    expect(untrack(() => ids(f.view))).toBe("abcx");
    expect(f.lengths.at(-1)).toBe(4);

    // A settling later reveals nothing of the probes.
    ga.release();
    await settle(doneA);
    expect(untrack(() => ids(f.view))).toBe("abcx");
    expect(f.lengths.at(-1)).toBe(4);
    f.dispose();
    flush();
  });
});
