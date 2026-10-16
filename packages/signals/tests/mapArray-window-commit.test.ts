/**
 * mapArray general-path commit (2026-10-15): the pass stages only the changed
 * window and commits the bookkeeping arrays in place, shifting the suffix with
 * `copyWithin`. These tests pin the semantics against first principles for
 * the edit shapes that used to pay full-length staging — one-item and sparse
 * removals and insertions at the head, tail and middle — in every mode:
 * survivors keep their owner (same mapped object), leavers dispose exactly
 * once, after commit, row signals take the new item, index signals take the
 * new index, duplicates pair the way they always did, the small-move path
 * keeps its shapes, and an aborted pass leaves everything untouched.
 */
import { describe, expect, it } from "vitest";
import {
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  mapArray,
  onCleanup
} from "../src/index.js";
import { __smallMoveHits } from "../src/map.js";

interface Item {
  id: number;
}
interface Mapped {
  item: Item;
  seq: number;
}

const items = (n: number, from = 0): Item[] =>
  Array.from({ length: n }, (_, i) => ({ id: from + i }));
const ids = (m: { item: Item }[]) => m.map(x => x.item.id);
const smallMoveHits = () => __smallMoveHits();

/** xorshift32 in integer space: the multiplicative LCG used elsewhere loses
 * precision past 2^53 and can fall into a fixed point, which hangs a
 * "pick k distinct indices" loop. */
function xorshift(seed: number) {
  let s = seed | 0 || 1;
  return (n: number) => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) % n;
  };
}

/** Plain mode: arity-1 mapper, identity keyed. */
function plain(initial: Item[]) {
  let seq = 0;
  const disposed: number[] = [];
  const [$src, setSrc] = createSignal(initial);
  let map!: () => Mapped[];
  const dispose = createRoot(d => {
    map = mapArray($src, (item: Item) => {
      const m = { item, seq: seq++ };
      onCleanup(() => disposed.push(m.seq));
      return m;
    });
    map();
    return d;
  });
  const set = (next: Item[]) => {
    setSrc(next);
    flush();
  };
  return { map, set, disposed, dispose, created: () => seq };
}

/** Survivors (by id) must keep the exact mapped object they had before. */
function expectSurvivorsKept(before: Mapped[], after: Mapped[]) {
  const byId = new Map(before.map(m => [m.item.id, m]));
  for (const m of after) {
    const prev = byId.get(m.item.id);
    if (prev) expect(m, `row ${m.item.id} keeps its owner`).toBe(prev);
  }
}

describe("mapArray window commit — edit shapes", () => {
  it("removeLast / removeFirst / remove one in the middle: one owner disposed, survivors kept", () => {
    for (const pos of [499, 0, 250]) {
      const p = plain(items(500));
      const src = p.map().map(m => m.item);
      const before = p.map().slice();
      const s0 = smallMoveHits();
      const next = src.filter((_, i) => i !== pos);
      p.set(next);
      if (__DEV__) expect(smallMoveHits()).toBe(s0);
      expect(ids(p.map())).toEqual(next.map(i => i.id));
      expectSurvivorsKept(before, p.map());
      expect(p.disposed).toEqual([before[pos].seq]);
      expect(p.created()).toBe(500);
      p.dispose();
    }
  });

  it("insertLast / insertFirst / insert one in the middle: one owner created, survivors kept", () => {
    for (const pos of [500, 0, 250]) {
      const p = plain(items(500));
      const src = p.map().map(m => m.item);
      const before = p.map().slice();
      const next = [...src.slice(0, pos), { id: 9999 }, ...src.slice(pos)];
      p.set(next);
      expect(ids(p.map())).toEqual(next.map(i => i.id));
      expectSurvivorsKept(before, p.map());
      expect(p.map()[pos].seq).toBe(500); // the one created row
      expect(p.disposed).toEqual([]);
      p.dispose();
    }
  });

  it("scattered removals (every 3rd of 300) and a contiguous run (50 at 100)", () => {
    const p = plain(items(300));
    const src = p.map().map(m => m.item);
    let before = p.map().slice();
    const sparse = src.filter((_, i) => i % 3 !== 0);
    p.set(sparse);
    expect(ids(p.map())).toEqual(sparse.map(i => i.id));
    expectSurvivorsKept(before, p.map());
    expect(p.disposed.length).toBe(100);
    expect(new Set(p.disposed)).toEqual(
      new Set(before.filter((_, i) => i % 3 === 0).map(m => m.seq))
    );

    before = p.map().slice();
    const run = [...sparse.slice(0, 100), ...sparse.slice(150)];
    p.set(run);
    expect(ids(p.map())).toEqual(run.map(i => i.id));
    expectSurvivorsKept(before, p.map());
    expect(p.disposed.length).toBe(150);
    p.dispose();
  });

  it("scattered insertions (one every 4th slot) and a contiguous run (100 at 50)", () => {
    const p = plain(items(200));
    const src = p.map().map(m => m.item);
    let before = p.map().slice();
    const next: Item[] = [];
    let fresh = 1000;
    src.forEach((it, i) => {
      if (i % 4 === 0) next.push({ id: fresh++ });
      next.push(it);
    });
    p.set(next);
    expect(ids(p.map())).toEqual(next.map(i => i.id));
    expectSurvivorsKept(before, p.map());
    expect(p.created()).toBe(250);
    expect(p.disposed).toEqual([]);

    before = p.map().slice();
    const cur = p.map().map(m => m.item);
    const run = [...cur.slice(0, 50), ...items(100, 5000), ...cur.slice(50)];
    p.set(run);
    expect(ids(p.map())).toEqual(run.map(i => i.id));
    expectSurvivorsKept(before, p.map());
    expect(p.created()).toBe(350);
    p.dispose();
  });

  it("a replacement, a swap, a reverse, and a remove-plus-insert: correct, survivors kept", () => {
    const p = plain(items(100));
    const src = p.map().map(m => m.item);
    const shapes: Array<[string, Item[], number]> = [
      ["replace middle", src.map((it, i) => (i === 50 ? { id: 777 } : it)), 1],
      [
        "swap",
        (() => {
          const n = [...src];
          [n[1], n[98]] = [n[98], n[1]];
          return n;
        })(),
        0
      ],
      ["reverse", [...src].reverse(), 0],
      ["remove one + insert another", [...src.slice(0, 10), { id: 888 }, ...src.slice(11)], 1]
    ];
    for (const [name, next, disposals] of shapes) {
      const q = plain(src);
      const before = q.map().slice();
      q.set(next);
      expect(ids(q.map()), name).toEqual(next.map(i => i.id));
      expectSurvivorsKept(before, q.map());
      expect(q.disposed.length, name).toBe(disposals);
      q.dispose();
    }
    p.dispose();
  });

  it("a large plain window with displaced survivors still goes to the small-move path", () => {
    // Drop 5 rows from the middle and rotate the rest by one: the small-move
    // tests pin this shape to their counter; the subsequence path must not
    // take it from them.
    const p = plain(items(300));
    const src = p.map().map(m => m.item);
    const kept = src.filter((_, i) => i < 100 || i >= 105);
    const rotated = [...kept.slice(1), kept[0]];
    const s0 = smallMoveHits();
    p.set(rotated);
    expect(smallMoveHits()).toBe(s0 + 1);
    expect(ids(p.map())).toEqual(rotated.map(i => i.id));
    p.dispose();
  });
});

describe("mapArray window commit — index signals (arity-2 mapper)", () => {
  function indexed(initial: Item[]) {
    let seq = 0;
    const disposed: number[] = [];
    const [$src, setSrc] = createSignal(initial);
    let map!: () => (Mapped & { index: () => number })[];
    const dispose = createRoot(d => {
      map = mapArray($src, (item: Item, index: () => number) => {
        const m = { item, seq: seq++, index };
        onCleanup(() => disposed.push(m.seq));
        return m;
      });
      map();
      return d;
    });
    return {
      map,
      set: (n: Item[]) => {
        setSrc(n);
        flush();
      },
      disposed,
      dispose
    };
  }

  it("removeFirst shifts every surviving index down by one", () => {
    const p = indexed(items(50));
    const before = p.map().slice();
    p.set(before.slice(1).map(m => m.item));
    const after = p.map();
    expect(after.length).toBe(49);
    after.forEach((m, i) => {
      expect(m).toBe(before[i + 1]);
      expect(m.index()).toBe(i);
    });
    expect(p.disposed).toEqual([before[0].seq]);
    p.dispose();
  });

  it("insert at the head and in the middle gives survivors their new index and the new rows theirs", () => {
    const p = indexed(items(50));
    const before = p.map().slice();
    const src = before.map(m => m.item);
    const next = [{ id: 900 }, ...src.slice(0, 25), { id: 901 }, ...src.slice(25)];
    p.set(next);
    const after = p.map();
    expect(ids(after)).toEqual(next.map(i => i.id));
    after.forEach((m, i) => expect(m.index(), `index of row ${m.item.id}`).toBe(i));
    expectSurvivorsKept(before, after);
    expect(p.disposed).toEqual([]);
    p.dispose();
  });
});

describe("mapArray window commit — key function (row accessors)", () => {
  function keyed(initial: Item[]) {
    let seq = 0;
    const disposed: number[] = [];
    const [$src, setSrc] = createSignal(initial);
    let map!: () => { row: () => Item; index: () => number; seq: number }[];
    const dispose = createRoot(d => {
      map = mapArray(
        $src,
        (row: () => Item, index: () => number) => {
          const m = { row, index, seq: seq++ };
          onCleanup(() => disposed.push(m.seq));
          return m;
        },
        { keyed: (it: Item) => it.id }
      );
      map();
      return d;
    });
    return {
      map,
      set: (n: Item[]) => {
        setSrc(n);
        flush();
      },
      disposed,
      dispose,
      created: () => seq
    };
  }

  it("removal with every survivor re-created as a new object: same owners, row accessors serve the new objects", () => {
    const p = keyed(items(40));
    const before = p.map().slice();
    const next = before.map(m => ({ ...m.row() })).filter((_, i) => i !== 7 && i !== 20);
    p.set(next);
    const after = p.map();
    expect(after.length).toBe(38);
    after.forEach((m, i) => {
      expect(m.row()).toBe(next[i]); // the NEW object, same key
      expect(m.index()).toBe(i);
    });
    const removedSeqs = [before[7].seq, before[20].seq];
    expect(new Set(p.disposed)).toEqual(new Set(removedSeqs));
    expect(p.created()).toBe(40);
    const survivorsBefore = before.filter((_, i) => i !== 7 && i !== 20);
    after.forEach((m, i) => expect(m.seq).toBe(survivorsBefore[i].seq));
    p.dispose();
  });

  it("insertion by key: created rows land at their positions, survivors keep owners and take new objects", () => {
    const p = keyed(items(40));
    const before = p.map().slice();
    const copies = before.map(m => ({ ...m.row() }));
    const next = [
      ...copies.slice(0, 5),
      { id: 500 },
      ...copies.slice(5, 30),
      { id: 501 },
      { id: 502 },
      ...copies.slice(30)
    ];
    p.set(next);
    const after = p.map();
    expect(after.map(m => m.row().id)).toEqual(next.map(i => i.id));
    after.forEach((m, i) => {
      expect(m.row()).toBe(next[i]);
      expect(m.index()).toBe(i);
    });
    expect(p.created()).toBe(43);
    expect([after[5].seq, after[31].seq, after[32].seq]).toEqual([40, 41, 42]);
    expect(p.disposed).toEqual([]);
    p.dispose();
  });
});

describe("mapArray window commit — keyed: false (by index)", () => {
  it("tail growth and tail shrink: row accessors read the new items, owners kept", () => {
    const [$src, setSrc] = createSignal(items(10));
    let map!: () => { row: () => Item; index: number }[];
    const dispose = createRoot(d => {
      map = mapArray($src, (row: () => Item, index: number) => ({ row, index }), { keyed: false });
      map();
      return d;
    });
    const before = map().slice();
    setSrc(items(13, 100));
    flush();
    expect(map().length).toBe(13);
    for (let i = 0; i < 10; i++) expect(map()[i]).toBe(before[i]);
    map().forEach((m, i) => {
      expect(m.row().id).toBe(100 + i);
      expect(m.index).toBe(i);
    });
    setSrc(items(4, 200));
    flush();
    expect(map().length).toBe(4);
    for (let i = 0; i < 4; i++) {
      expect(map()[i]).toBe(before[i]);
      expect(map()[i].row().id).toBe(200 + i);
    }
    dispose();
  });
});

describe("mapArray window commit — duplicates and the randomized oracle", () => {
  it("identity duplicates: [A, A, B] → [A, B] disposes one A; [A, B] → [A, A, B] creates one", () => {
    const A = { id: 1 },
      B = { id: 2 };
    const p = plain([A, A, B]);
    const before = p.map().slice();
    p.set([A, B]);
    expect(ids(p.map())).toEqual([1, 2]);
    expect(p.disposed.length).toBe(1);
    expect(p.map()[0]).toBe(before[0]);
    expect(p.map()[1]).toBe(before[2]);
    p.set([A, A, B]);
    expect(ids(p.map())).toEqual([1, 1, 2]);
    expect(p.created()).toBe(4);
    expect(p.disposed.length).toBe(1);
    p.dispose();
  });

  it("random pure removals and insertions, 300 rounds, plain mode: survivors keep owners, leavers dispose once, counts balance", () => {
    const rnd = xorshift(0x9e3779b9);
    const p = plain(items(200));
    let nextId = 200;
    for (let round = 0; round < 300; round++) {
      const cur = p.map().map(m => m.item);
      const before = p.map().slice();
      const disposedBefore = p.disposed.length;
      const createdBefore = p.created();
      let next: Item[];
      let removed = 0,
        inserted = 0;
      if (cur.length > 20 && rnd(2) === 0) {
        const k = 1 + rnd(Math.min(10, cur.length - 10));
        const drop = new Set<number>();
        while (drop.size < k) drop.add(rnd(cur.length));
        next = cur.filter((_, i) => !drop.has(i));
        removed = k;
      } else {
        const k = 1 + rnd(10);
        next = [...cur];
        for (let n = 0; n < k; n++) next.splice(rnd(next.length + 1), 0, { id: nextId++ });
        inserted = k;
      }
      p.set(next);
      expect(ids(p.map()), `round ${round} order`).toEqual(next.map(i => i.id));
      expectSurvivorsKept(before, p.map());
      expect(p.disposed.length - disposedBefore, `round ${round} disposals`).toBe(removed);
      expect(p.created() - createdBefore, `round ${round} creations`).toBe(inserted);
    }
    p.dispose();
    flush();
    expect(p.disposed.length).toBe(p.created());
  });
});

describe("mapArray window commit — randomized oracle in index mode", () => {
  it("random pure removals and insertions, 300 rounds, arity-2 mapper", () => {
    const rnd = xorshift(0x2545f491);
    let seq = 0;
    const disposed: number[] = [];
    const [$src, setSrc] = createSignal(items(200));
    let map!: () => (Mapped & { index: () => number })[];
    const dispose = createRoot(d => {
      map = mapArray($src, (item: Item, index: () => number) => {
        const m = { item, seq: seq++, index };
        onCleanup(() => disposed.push(m.seq));
        return m;
      });
      map();
      return d;
    });
    let nextId = 200;
    for (let round = 0; round < 300; round++) {
      const cur = map().map(m => m.item);
      const before = map().slice();
      const disposedBefore = disposed.length;
      const createdBefore = seq;
      let next: Item[];
      let removed = 0,
        inserted = 0;
      if (cur.length > 20 && rnd(2) === 0) {
        const k = 1 + rnd(Math.min(10, cur.length - 10));
        const drop = new Set<number>();
        while (drop.size < k) drop.add(rnd(cur.length));
        next = cur.filter((_, i) => !drop.has(i));
        removed = k;
      } else {
        const k = 1 + rnd(10);
        next = [...cur];
        for (let n = 0; n < k; n++) next.splice(rnd(next.length + 1), 0, { id: nextId++ });
        inserted = k;
      }
      setSrc(next);
      flush();
      expect(ids(map()), `round ${round} order`).toEqual(next.map(i => i.id));
      expectSurvivorsKept(before, map());
      map().forEach((m, i) => expect(m.index(), `round ${round} index of ${m.item.id}`).toBe(i));
      expect(disposed.length - disposedBefore, `round ${round} disposals`).toBe(removed);
      expect(seq - createdBefore, `round ${round} creations`).toBe(inserted);
    }
    dispose();
    flush();
    expect(disposed.length).toBe(seq);
  });
});

describe("mapArray window commit — NotReadyError abort on an insertion (#2903 contract)", () => {
  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(res => (resolve = res));
    return { promise, resolve };
  }
  const settle = async () => {
    await new Promise(r => setTimeout(r, 0));
    flush();
  };

  it("an inserted row that suspends aborts the pass with the live arrays untouched; the retry lands it", async () => {
    const gate = deferred<string>();
    const [$source, setSource] = createSignal(["a", "b", "c"]);
    const [$useAsync, setUseAsync] = createSignal(false);
    const created: string[] = [];
    const disposed: string[] = [];
    let result = "";
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      const asyncVal = createMemo(async () => ($useAsync() ? gate.promise : "sync"));
      const map = mapArray(
        () => $source(),
        (item: string) => {
          created.push(item);
          onCleanup(() => disposed.push(item));
          return item === "x" ? `x:${asyncVal()}` : item;
        }
      );
      const b = createLoadingBoundary(
        () => map().join(","),
        () => "loading"
      );
      createRenderEffect(
        () => (result = b()),
        () => {}
      );
    });
    flush();
    expect(result).toBe("a,b,c");

    setUseAsync(true);
    setSource(["a", "b", "x", "c"]); // a pure insertion of "x", and it suspends
    flush();
    expect(result).toBe("a,b,c"); // held: nothing committed
    expect(created.filter(i => i === "x").length).toBeGreaterThan(0);
    expect(disposed).toEqual(expect.arrayContaining(["x"])); // the aborted row's owner was disposed with the pass

    gate.resolve("go");
    await settle();
    expect(result).toBe("a,b,x:go,c");

    dispose();
    flush();
    const counts = new Map<string, number>();
    for (const c of created) counts.set(c, (counts.get(c) ?? 0) + 1);
    for (const d of disposed) counts.set(d, (counts.get(d) ?? 0) - 1);
    for (const [item, n] of counts) expect(n, `owner balance for row "${item}"`).toBe(0);
  });
});
