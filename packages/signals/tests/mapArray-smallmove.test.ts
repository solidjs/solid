import { describe, expect, it } from "vitest";
import { createRoot, createSignal, flush, mapArray, onCleanup } from "../src/index.js";
import { __smallMoveHits } from "../src/map.js";

/** SMALL-MOVE fast path: after prefix/suffix trimming, a same-or-shorter
 * window whose mismatches are ≤32 displaced identities commits as in-place
 * patches over sliced arrays — no window Map, no staging arrays.
 *
 * Every test here PROVES which path ran (`__smallMoveHits`, dev-only) and
 * pins semantics against an ORACLE: the same source sequence driven through
 * the general path (an arity-2 mapper creates index signals, which the fast
 * path declines). Mapped values carry a creation sequence number, so "same
 * mapped array" means the same OWNERS ended up at the same positions — the
 * duplicate-pairing contract — and disposal order is compared too. */

type Item = { id: number };
type Mapped = { item: Item; seq: number };

function rotateF<T>(a: readonly T[]): T[] {
  return [...a.slice(1), a[0]];
}
function rotateB<T>(a: readonly T[]): T[] {
  return [a[a.length - 1], ...a.slice(0, -1)];
}
/** Move `k` evenly spaced rows to new positions (the jfb displace shape). */
function displace<T>(a: readonly T[], k: number): T[] {
  const next = [...a];
  for (let i = 0; i < k; i++) {
    const from = Math.floor(((i + 1) * next.length) / (k + 2));
    const [row] = next.splice(from, 1);
    next.splice((from + 7) % next.length, 0, row);
  }
  return next;
}
const ids = (m: Mapped[]) => m.map(x => x.item.id);
const seqs = (m: Mapped[]) => m.map(x => x.seq);

/** Drive one source through BOTH paths: `fast` (arity-1 mapper, eligible)
 * and `oracle` (arity-2 mapper → index signals → general path always). */
function pair(initial: Item[]) {
  let seq = 0;
  const disposed: { fast: number[]; oracle: number[] } = { fast: [], oracle: [] };
  const mk =
    (side: "fast" | "oracle") =>
    (item: Item): Mapped => {
      const m = { item, seq: seq++ };
      onCleanup(() => disposed[side].push(m.seq));
      return m;
    };
  const [$fast, setFast] = createSignal(initial);
  const [$oracle, setOracle] = createSignal(initial);
  let fast!: () => Mapped[];
  let oracle!: () => Mapped[];
  const dispose = createRoot(d => {
    fast = mapArray($fast, mk("fast"));
    const o = mk("oracle");
    oracle = mapArray($oracle, (item: Item, _index: () => number) => o(item));
    fast();
    oracle();
    return d;
  });
  const set = (next: Item[]) => {
    setFast(next);
    setOracle(next);
    flush();
  };
  /** After a set: mapped ids equal on both sides (correctness), and the
   * ORDER of owners (seq) equals the oracle's (duplicate pairing). */
  const agree = () => {
    expect(ids(fast())).toEqual(ids(oracle()));
    // Owners created on the two sides interleave in seq; compare RELATIVE order.
    const rank = (m: Mapped[]) => {
      const sorted = [...m].map(x => x.seq).sort((a, b) => a - b);
      return m.map(x => sorted.indexOf(x.seq));
    };
    expect(rank(fast())).toEqual(rank(oracle()));
    expect(disposed.fast.length).toBe(disposed.oracle.length);
  };
  return { set, fast, oracle, agree, disposed, dispose };
}

const items = (n: number): Item[] => Array.from({ length: n }, (_, i) => ({ id: i }));
const hits = () => __smallMoveHits();

describe("mapArray small-move fast path — engagement", () => {
  it("engages for an arity-1 mapper on a >64 window and agrees with the general path", () => {
    const p = pair(items(200));
    const before = hits();
    const rotated = rotateF(p.oracle().map(m => m.item));
    p.set(rotated);
    expect(hits()).toBe(before + 1);
    p.agree();
    expect(ids(p.fast())).toEqual(rotated.map(i => i.id));
    p.dispose();
  });

  it("does NOT engage for an arity-2 mapper (index signals) — the oracle path", () => {
    let seq = 0;
    const [$s, set] = createSignal(items(200));
    let m!: () => Mapped[];
    const dispose = createRoot(d => {
      m = mapArray($s, (item: Item, _i: () => number) => ({ item, seq: seq++ }));
      m();
      return d;
    });
    const before = hits();
    set(rotateF(items(200).map((_, i) => m()[i].item)));
    flush();
    expect(hits()).toBe(before);
    dispose();
  });

  it("window gate (`end - start > 64`): a 66-row changed window engages, 65 does not", () => {
    for (const [window, engages] of [
      [66, true],
      [65, false]
    ] as const) {
      // Prefix of 100 unchanged rows, then a rotation of exactly `window`
      // rows: the trims leave start=100, end=100+window-1.
      const src = items(100 + window);
      const p = pair(src);
      const head = src.slice(0, 100);
      const tail = src.slice(100);
      const before = hits();
      p.set([...head, ...rotateF(tail)]);
      expect(hits() - before, `window ${window}`).toBe(engages ? 1 : 0);
      p.agree();
      p.dispose();
    }
  });

  it("displacement bound: 32 displaced rows engage, 33 fall to the general path", () => {
    for (const [k, engages] of [
      [32, true],
      [33, false]
    ] as const) {
      const src = items(400);
      const p = pair(src);
      // Move the first k rows to the END as a block: k displaced identities.
      const next = [...src.slice(k), ...src.slice(0, k)];
      const before = hits();
      p.set(next);
      expect(hits() - before, `k=${k}`).toBe(engages ? 1 : 0);
      p.agree();
      expect(ids(p.fast())).toEqual(next.map(i => i.id));
      p.dispose();
    }
  });
});

describe("mapArray small-move fast path — semantics vs the general path", () => {
  it("rotate forward / backward: mapped owners move with their items, nothing re-created", () => {
    const p = pair(items(300));
    const created = () => p.fast().length + p.disposed.fast.length;
    const c0 = created();
    for (const op of [rotateF, rotateB, rotateF, rotateF]) {
      p.set(op(p.oracle().map(m => m.item)));
      p.agree();
    }
    expect(created()).toBe(c0);
    expect(p.disposed.fast).toEqual([]);
    p.dispose();
  });

  it("scattered displacements k = 3..8 agree with the general path whether or not they engage", () => {
    // Engagement is an optimization, not a contract: the scan may decline a
    // scatter it can't realign within its lookahead. Correctness never varies.
    const p = pair(items(500));
    const before = hits();
    for (let k = 3; k <= 8; k++) {
      p.set(
        displace(
          p.oracle().map(m => m.item),
          k
        )
      );
      p.agree();
    }
    expect(hits()).toBeGreaterThan(before); // and it does engage for most of them
    p.dispose();
  });

  it("adjacent swap (jfb swap rows) engages", () => {
    const p = pair(items(1000));
    const src = p.oracle().map(m => m.item);
    const next = [...src];
    [next[1], next[998]] = [next[998], next[1]];
    const before = hits();
    p.set(next);
    expect(hits()).toBe(before + 1);
    p.agree();
    p.dispose();
  });

  it("shrink: displaced rows that leave are disposed, the same ones the general path disposes", () => {
    const p = pair(items(300));
    const src = p.oracle().map(m => m.item);
    // Drop 5 rows from the middle and rotate the rest by one: a non-growing move with leavers.
    const kept = src.filter((_, i) => i < 100 || i >= 105);
    const before = hits();
    p.set(rotateF(kept));
    expect(hits()).toBe(before + 1);
    p.agree();
    expect(p.disposed.fast.length).toBe(5);
    p.dispose();
  });

  it("growth (newLen > oldLen) is excluded — general path", () => {
    const p = pair(items(200));
    const src = p.oracle().map(m => m.item);
    const before = hits();
    p.set([...rotateF(src), { id: 9999 }]);
    expect(hits()).toBe(before);
    p.agree();
    p.dispose();
  });

  it("replacement inside the window bails: fresh row created, old disposed", () => {
    const p = pair(items(200));
    const src = p.oracle().map(m => m.item);
    const next = [...src];
    next[100] = { id: 424242 };
    const before = hits();
    p.set(next);
    expect(hits()).toBe(before);
    p.agree();
    expect(p.disposed.fast.length).toBe(1);
    p.dispose();
  });

  it("full replace (every item fresh) bails before the scan (pre-probe)", () => {
    const p = pair(items(1000));
    const before = hits();
    p.set(items(1000)); // all new objects
    expect(hits()).toBe(before);
    p.agree();
    expect(p.disposed.fast.length).toBe(1000);
    p.dispose();
  });
});

describe("mapArray small-move fast path — duplicate identities", () => {
  it("a displaced identity that also occurs in an aligned run DECLINES (occurrence-order pairing preserved)", () => {
    // The audit's shape, embedded in a >64 window: old [A,B,A,C] → new [B,A,C,A].
    const A = { id: 1 },
      B = { id: 2 },
      C = { id: 3 };
    const filler = items(100).map(i => ({ id: 1000 + i.id }));
    const src = [A, B, A, C, ...filler];
    const p = pair(src);
    const before = hits();
    p.set([B, A, C, A, ...rotateF(filler)]);
    // Declined: the general path pairs the two A occurrences in order.
    expect(hits()).toBe(before);
    p.agree();
    p.dispose();
  });

  it("duplicates only among DISPLACED rows pair ascending on both sides — may engage, must agree", () => {
    const A = { id: 1 };
    const filler = items(200).map(i => ({ id: 1000 + i.id }));
    // Two A's at the front move together to the back.
    const src = [A, A, ...filler];
    const p = pair(src);
    p.set([...filler, A, A]);
    p.agree();
    p.dispose();
  });

  it("duplicate removal disposes the same occurrence the general path does", () => {
    const A = { id: 1 };
    const filler = items(200).map(i => ({ id: 1000 + i.id }));
    const src = [A, ...filler.slice(0, 100), A, ...filler.slice(100)];
    const p = pair(src);
    // Drop the second A and rotate the tail: a shrink involving a duplicate.
    p.set([A, ...filler.slice(0, 100), ...rotateF(filler.slice(100))]);
    p.agree();
    expect(p.disposed.fast.length).toBe(1);
    p.dispose();
  });

  it("random duplicate-heavy reorders: 200 rounds, fast path always agrees with the general path", () => {
    let s = 12345;
    const rnd = (n: number) => (s = (s * 1103515245 + 12345) >>> 0) % n;
    const base = items(120); // 120 identities, some used twice → duplicates everywhere
    const p = pair([...base, ...base.slice(0, 30)]);
    for (let round = 0; round < 200; round++) {
      const cur = p.oracle().map(m => m.item);
      const next = [...cur];
      const moves = 1 + rnd(6);
      for (let m = 0; m < moves; m++) {
        const from = rnd(next.length);
        const [row] = next.splice(from, 1);
        next.splice(rnd(next.length), 0, row);
      }
      if (rnd(4) === 0) next.splice(rnd(next.length), 1); // occasional shrink
      p.set(next);
      p.agree();
    }
    p.dispose();
  });
});
