/**
 * #4474 (D-22: laziness is never observable) — the release runs after the retry.
 *
 * A memo on the observation lifecycle (unowned, or `lazy: true`) that blocked on an async source
 * is re-enqueued by the source's landing (`settlePendingSource`: the retry) and, with nobody
 * reading it, is a release candidate (#2934). Before, the release ran first and pulled the retry
 * back out of the heap: the node never computed the landing and woke later with no value. Now the
 * retry runs — once, as the owned twin's does — and the node is released at that pass's tail.
 *
 * Pinned here: (1) an unowned ASYNC memo over a landing source starts exactly the one flight its
 * owned twin starts, is released when that flight lands with nobody watching (#2934: no
 * perpetual recompute), and a later read revives it (#3078); (2) a dormant memo merely dirtied in
 * the same tick — no settle-walk retry — is still reclaimed by the pre-heap sweep, not recomputed
 * (the #3078 contract this fix carves nothing out of).
 */
import { describe, expect, it } from "vitest";
import {
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest
} from "../src/index.js";

const task = () => new Promise<void>(r => setTimeout(r, 0));

describe("#4474: a released memo's queued retry runs before the release", () => {
  async function asyncOverAsync(owned: boolean) {
    const asks: { v: number; resolve: (v: number) => void }[] = [];
    const echoes: { v: number; resolve: (v: string) => void }[] = [];
    const [s, setS] = createSignal(1);
    let m!: () => number;
    let a!: () => string;
    let runs = 0;
    const make = () => {
      m = createMemo(() => {
        const v = s();
        return new Promise<number>(resolve => asks.push({ v, resolve }));
      });
      a = createMemo(() => {
        const v = m();
        runs++;
        return new Promise<string>(resolve => echoes.push({ v, resolve }));
      });
    };
    if (owned) createRoot(make);
    else make();
    flush();
    // Blocked on `m` at creation: no flight of its own yet.
    expect(runs).toBe(0);
    expect(asks.map(x => x.v)).toEqual([1]);

    // m lands with nobody reading `a`: the retry the settle walk queued runs — one flight.
    asks.shift()!.resolve(1);
    await task();
    flush();
    const atLanding = { runs, echoes: echoes.map(e => e.v) };

    // a's own flight lands with nobody watching: released (#2934), not re-run.
    echoes.shift()!.resolve("e1");
    await task();
    flush();
    const afterEcho = { runs, left: echoes.length };

    // Released for real: a write upstream recomputes neither m nor a (both unobserved).
    setS(2);
    flush();
    await task();
    flush();
    const afterWrite = { runs, asks: asks.map(x => x.v), echoes: echoes.map(e => e.v) };

    // A later read revives it (#3078): m re-asks for s=2 and a waits on it with its value.
    let read = "";
    createRoot(() =>
      createEffect(
        () => `l:${latest(a)} p:${isPending(a)}`,
        v => void (read = v)
      )
    );
    flush();
    const revived = { runs, asks: asks.map(x => x.v), read };
    asks.shift()!.resolve(2);
    await task();
    flush();
    echoes.shift()!.resolve("e2");
    await task();
    flush();
    return { atLanding, afterEcho, afterWrite, revived, final: { runs, read } };
  }

  it("an unowned async memo over a landing source: one flight at the landing, released after it, revived by a read", async () => {
    const r = await asyncOverAsync(false);
    // The retry ran once at the landing: the flight the owned twin also starts.
    expect(r.atLanding).toEqual({ runs: 1, echoes: [1] });
    // Its landing released the node: no second pass.
    expect(r.afterEcho).toEqual({ runs: 1, left: 0 });
    // No perpetual recompute (#2934): the write reached nothing.
    expect(r.afterWrite).toEqual({ runs: 1, asks: [], echoes: [] });
    // Revived by a read (#3078): m re-asks, a has the landed value and waits on it (D-22, D-23).
    expect(r.revived).toEqual({ runs: 1, asks: [2], read: "l:e1 p:true" });
    expect(r.final).toEqual({ runs: 2, read: "l:e2 p:false" });
  });

  it("the owned twin starts the same flight at the landing (the control)", async () => {
    const r = await asyncOverAsync(true);
    expect(r.atLanding).toEqual({ runs: 1, echoes: [1] });
    expect(r.afterEcho).toEqual({ runs: 1, left: 0 });
    // Owned, never released: the write re-asks m and re-runs a — the lifecycle, not the screen.
    expect(r.afterWrite.asks).toEqual([2]);
  });

  it("a dormant memo merely dirtied in the same tick is reclaimed, not recomputed (#3078)", () => {
    const [s, setS] = createSignal(0);
    let runs = 0;
    const m = createMemo(() => (runs++, s() * 2));
    expect(runs).toBe(1);
    // An untracked read queues the unobserved memo for the dormancy sweep.
    expect(m()).toBe(0);
    expect(runs).toBe(1);
    // Dirtied in the same tick: the pre-heap sweep reclaims it before the heap runs it.
    setS(1);
    flush();
    expect(runs).toBe(1);
    // A read revives it with the current value.
    expect(m()).toBe(2);
    expect(runs).toBe(2);
  });
});
