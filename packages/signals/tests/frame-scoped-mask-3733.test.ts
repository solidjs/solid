import { describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  latest
} from "../src/index.js";

// CS-R31 / A34(3), amended 2026-10-01 (#3733, GabbeV). A manual write to a
// writable derived node (`createSignal(fn)`, `createStore(fn)`) wins over its
// own frame's re-run, in either call order — propagation is deferred to the
// flush (#2692). A source change in a later frame re-runs the derivation with
// the write as `prev` (or in the draft). Holds and actions don't extend the
// frame: the mask used to lift only at `commitPendingNode`, so inside an
// action it lasted the whole hold and later source changes were dropped.

async function settle() {
  for (let r = 0; r < 5; r++) {
    for (let i = 0; i < 10; i++) await Promise.resolve();
    flush();
  }
}

describe("the write's own frame: the write wins in either order (#2692)", () => {
  describe("createSignal(fn)", () => {
    function setup() {
      return createRoot(() => {
        const [a, setA] = createSignal(0);
        const [b, setB] = createSignal(() => a());
        return { a, setA, b, setB };
      });
    }

    it("source change, then write", () => {
      const h = setup();
      flush();
      h.setA(1);
      h.setB(2);
      flush();
      expect(h.b()).toBe(2);
    });

    it("write, then source change", () => {
      const h = setup();
      flush();
      h.setB(2);
      h.setA(1);
      flush();
      expect(h.b()).toBe(2);
    });

    it("write, then source change through an intermediate memo", () => {
      let observed: number | undefined;
      const h = createRoot(() => {
        const [a, setA] = createSignal(0);
        const m = createMemo(() => a() * 10);
        const [c, setC] = createSignal(() => m());
        createRenderEffect(c, v => void (observed = v));
        return { setA, setC };
      });
      flush();
      h.setC(99);
      h.setA(1);
      flush();
      expect(observed).toBe(99);
    });

    it("a same-value write holds for its frame", () => {
      const h = setup();
      flush();
      h.setA(1);
      h.setB(0);
      flush();
      expect(h.b()).toBe(0);
      h.setA(2);
      flush();
      expect(h.b()).toBe(2);
    });
  });

  describe("createStore(fn)", () => {
    function setup() {
      return createRoot(() => {
        const [a, setA] = createSignal(0);
        const [s, setS] = createStore<{ v: number }>(
          d => {
            d.v = a();
          },
          { v: 0 }
        );
        return { setA, s, setS };
      });
    }

    it("source change, then write", () => {
      const h = setup();
      flush();
      h.setA(1);
      h.setS(d => {
        d.v = 99;
      });
      flush();
      expect(h.s.v).toBe(99);
    });

    it("write, then source change", () => {
      const h = setup();
      flush();
      h.setS(d => {
        d.v = 99;
      });
      h.setA(1);
      flush();
      expect(h.s.v).toBe(99);
    });

    it("a same-value write holds for its frame", () => {
      const h = setup();
      flush();
      h.setA(1);
      h.setS(d => {
        d.v = 0;
      });
      flush();
      expect(h.s.v).toBe(0);
      h.setA(2);
      flush();
      expect(h.s.v).toBe(2);
    });
  });
});

describe("a source change in a later frame re-derives with the write as prior state", () => {
  it("createSignal(fn): the write is `prev`", () => {
    const h = createRoot(() => {
      const [a, setA] = createSignal(0);
      const [b, setB] = createSignal<number>(prev => Math.max(prev ?? 0, a()));
      return { setA, b, setB };
    });
    flush();
    h.setB(5);
    flush();
    h.setA(1);
    flush();
    expect(h.b()).toBe(5);
    h.setA(7);
    flush();
    expect(h.b()).toBe(7);
  });

  it("createStore(fn): the write is in the draft; unwritten keys follow the source", () => {
    const h = createRoot(() => {
      const [a, setA] = createSignal(0);
      const [s, setS] = createStore<{ v: number; hi: number; a: number }>(
        d => {
          d.a = a();
          d.v = a() * 100;
          d.hi = Math.max(d.hi, a());
        },
        { v: 0, hi: 0, a: 0 }
      );
      return { setA, s, setS };
    });
    flush();
    h.setS(d => {
      d.v = 999;
      d.hi = 50;
    });
    flush();
    h.setA(1);
    flush();
    expect([h.s.a, h.s.v, h.s.hi]).toEqual([1, 100, 50]);
  });
});

// #3733's report: a writable derived store for local failure state.
type Card = { id: string; column: number; moveFailed?: boolean };

function setupCardsStore() {
  const views: string[] = [];
  const h = createRoot(() => {
    const [source, setSource] = createSignal<Card[]>([{ id: "A", column: 0 }]);
    const [cards, setCards] = createStore<Card[]>(
      draft =>
        source().map(remote => {
          const old = draft.find(card => card.id === remote.id);
          return old?.moveFailed ? { ...remote, column: old.column, moveFailed: true } : remote;
        }),
      []
    );
    createRenderEffect(
      () => `S${source()[0].column} L${cards[0].column} F${cards[0].moveFailed === true}`,
      v => void views.push(v)
    );
    return { setSource, setCards };
  });
  flush();
  return { ...h, views };
}

function setupCardSignal() {
  const views: string[] = [];
  const h = createRoot(() => {
    const [source, setSource] = createSignal<Card>({ id: "A", column: 0 });
    const [card, setCard] = createSignal<Card>(prev => {
      const remote = source();
      return prev?.moveFailed ? { ...remote, column: prev.column, moveFailed: true } : remote;
    });
    createRenderEffect(
      () => `S${source().column} L${card().column} F${card().moveFailed === true}`,
      v => void views.push(v)
    );
    return { setSource, setCard };
  });
  flush();
  return { ...h, views };
}

describe("#3733: a write inside a held action, then a source change during the hold", () => {
  it("store: source written mid-hold → re-derives with the written draft, revealed with T", async () => {
    const h = setupCardsStore();
    h.setCards(d => {
      d[0].column = 1;
      d[0].moveFailed = true;
    });
    flush();
    expect(h.views.at(-1)).toBe("S0 L1 Ftrue");
    let release!: () => void;
    const done = action(function* () {
      h.setCards(d => {
        d[0].moveFailed = false;
      });
      yield new Promise<void>(r => (release = r));
    })();
    flush();
    h.setSource([{ id: "A", column: 2 }]);
    flush();
    release();
    await done;
    await settle();
    expect(h.views).toEqual(["S0 L0 Ffalse", "S0 L1 Ftrue", "S2 L2 Ffalse"]);
  });

  it("store: the issue's order — resolve(); setSource() in one timer callback", async () => {
    const h = setupCardsStore();
    h.setCards(d => {
      d[0].column = 1;
      d[0].moveFailed = true;
    });
    flush();
    await action(function* () {
      h.setCards(d => {
        d[0].moveFailed = false;
      });
      yield new Promise<void>(resolve =>
        setTimeout(() => {
          resolve();
          h.setSource([{ id: "A", column: 2 }]);
        }, 10)
      );
    })();
    await settle();
    expect(h.views.at(-1)).toBe("S2 L2 Ffalse");
  });

  it("store control: the flag cleared and committed before the action reconciles", () => {
    const h = setupCardsStore();
    h.setCards(d => {
      d[0].column = 1;
      d[0].moveFailed = true;
    });
    flush();
    h.setCards(d => {
      d[0].moveFailed = false;
    });
    flush();
    h.setSource([{ id: "A", column: 2 }]);
    flush();
    expect(h.views.at(-1)).toBe("S2 L2 Ffalse");
  });

  it("store control: source committed before the flag is cleared → the failed position is kept", () => {
    const h = setupCardsStore();
    h.setCards(d => {
      d[0].column = 1;
      d[0].moveFailed = true;
    });
    flush();
    h.setSource([{ id: "A", column: 2 }]);
    flush();
    expect(h.views.at(-1)).toBe("S2 L1 Ftrue");
    h.setCards(d => {
      d[0].moveFailed = false;
    });
    flush();
    expect(h.views.at(-1)).toBe("S2 L1 Ffalse");
  });

  it("createSignal(fn): source written mid-hold → re-derives with the write as prev", async () => {
    const h = setupCardSignal();
    h.setCard({ id: "A", column: 1, moveFailed: true });
    flush();
    expect(h.views.at(-1)).toBe("S0 L1 Ftrue");
    let release!: () => void;
    const done = action(function* () {
      h.setCard(p => ({ ...p, moveFailed: false }));
      yield new Promise<void>(r => (release = r));
    })();
    flush();
    h.setSource({ id: "A", column: 2 });
    flush();
    release();
    await done;
    await settle();
    expect(h.views).toEqual(["S0 L0 Ffalse", "S0 L1 Ftrue", "S2 L2 Ffalse"]);
  });

  it("createSignal(fn) control: the flag cleared and committed before reconciles", () => {
    const h = setupCardSignal();
    h.setCard({ id: "A", column: 1, moveFailed: true });
    flush();
    h.setCard(p => ({ ...p, moveFailed: false }));
    flush();
    h.setSource({ id: "A", column: 2 });
    flush();
    expect(h.views.at(-1)).toBe("S2 L2 Ffalse");
  });
});

describe("holds and actions don't extend the frame", () => {
  function setupAB(f: (a: number) => number) {
    const views: string[] = [];
    const h = createRoot(() => {
      const [a, setA] = createSignal(1);
      const [b, setB] = createSignal(() => f(a()));
      createRenderEffect(
        () => `a=${a()} b=${b()}`,
        v => void views.push(v)
      );
      return { setA, b, setB };
    });
    flush();
    return { ...h, views };
  }

  it("action setB(999), yield, mainline setA(2) → re-derives under T: a=2 b=2, no torn frame", async () => {
    const h = setupAB(a => a);
    let release!: () => void;
    const done = action(function* () {
      h.setB(999);
      yield new Promise<void>(r => (release = r));
    })();
    flush();
    expect(latest(h.b)).toBe(999);
    h.setA(2);
    flush();
    release();
    await done;
    await settle();
    expect(h.views).toEqual(["a=1 b=1", "a=2 b=2"]);
  });

  it("the same writes outside an action: setB(999) | setA(2) → a=2 b=2", () => {
    const h = setupAB(a => a);
    h.setB(999);
    flush();
    h.setA(2);
    flush();
    expect(h.views).toEqual(["a=1 b=1", "a=1 b=999", "a=2 b=2"]);
  });

  it("the action writes the derived node, yields, then writes its source → re-derives (a=2 b=200)", async () => {
    const h = setupAB(a => a * 100);
    let release!: () => void;
    const done = action(function* () {
      h.setB(999);
      yield new Promise<void>(r => (release = r));
      h.setA(2);
    })();
    flush();
    release();
    await done;
    await settle();
    expect(h.views).toEqual(["a=1 b=100", "a=2 b=200"]);
  });

  it("the action writes the source, yields, then writes the derived node → the write wins (a=2 b=999)", async () => {
    const h = setupAB(a => a * 100);
    let release!: () => void;
    const done = action(function* () {
      h.setA(2);
      yield new Promise<void>(r => (release = r));
      h.setB(999);
    })();
    flush();
    release();
    await done;
    await settle();
    expect(h.views).toEqual(["a=1 b=100", "a=2 b=999"]);
  });

  it("inside one action segment, write then source change is one frame → the write wins (a=2 b=999)", async () => {
    const h = setupAB(a => a * 100);
    let release!: () => void;
    const done = action(function* () {
      h.setB(999);
      h.setA(2);
      yield new Promise<void>(r => (release = r));
    })();
    flush();
    release();
    await done;
    await settle();
    expect(h.views).toEqual(["a=1 b=100", "a=2 b=999"]);
  });

  it("store fold: a write to one key inside T, then a source change mid-hold → the whole fold follows", async () => {
    const views: string[] = [];
    const h = createRoot(() => {
      const [a, setA] = createSignal(1);
      const [s, setS] = createStore(
        (d: { v: number; a: number }) => {
          d.a = a();
          d.v = a() * 100;
        },
        { v: 0, a: 0 }
      );
      createRenderEffect(
        () => `a=${a()} s.v=${s.v} s.a=${s.a}`,
        v => void views.push(v)
      );
      return { setA, setS };
    });
    flush();
    let release!: () => void;
    const done = action(function* () {
      h.setS(d => {
        d.v = 999;
      });
      yield new Promise<void>(r => (release = r));
    })();
    flush();
    h.setA(2);
    flush();
    release();
    await done;
    await settle();
    expect(views).toEqual(["a=1 s.v=100 s.a=1", "a=2 s.v=200 s.a=2"]);
  });

  describe("an async source landing in a later frame during the hold re-derives", () => {
    function setupAsync() {
      const views: string[] = [];
      const gates: (() => void)[] = [];
      const h = createRoot(() => {
        const [s, setS] = createSignal(1);
        const m = createMemo(async () => {
          const v = s();
          if (v !== 1) await new Promise<void>(r => gates.push(r));
          return v * 10;
        });
        const [b, setB] = createSignal<{ m: number; local?: number }>(prev => ({
          m: m(),
          local: prev?.local
        }));
        createRenderEffect(
          () => `m=${m()} b.m=${b().m} b.local=${b().local}`,
          v => void views.push(v)
        );
        return { setS, b, setB };
      });
      return { ...h, views, gates };
    }

    it("flight started mid-hold from mainline: the landing re-derives with the write as prev, revealed with T", async () => {
      const h = setupAsync();
      await settle();
      let release!: () => void;
      const done = action(function* () {
        h.setB(p => ({ ...p, m: 999, local: 7 }));
        yield new Promise<void>(r => (release = r));
      })();
      flush();
      h.setS(2);
      await settle();
      expect(h.gates.length).toBe(1);
      h.gates.shift()!();
      await settle();
      expect(latest(() => h.b().m)).toBe(20);
      release();
      await done;
      await settle();
      expect(h.views.at(-1)).toBe("m=20 b.m=20 b.local=7");
      expect(h.views).not.toContain("m=10 b.m=999 b.local=7");
    });

    // Already the behavior before #3733: the write lands on a node pending on
    // the flight, so the landing re-derives it either way. Pinned as the twin.
    it("flight started before the action: its landing mid-hold re-derives with the write as prev", async () => {
      const h = setupAsync();
      await settle();
      h.setS(2);
      await settle();
      expect(h.gates.length).toBe(1);
      let release!: () => void;
      const done = action(function* () {
        h.setB(p => ({ ...p, m: 999, local: 7 }));
        yield new Promise<void>(r => (release = r));
      })();
      flush();
      h.gates.shift()!();
      await settle();
      release();
      await done;
      await settle();
      expect(h.views.at(-1)).toBe("m=20 b.m=20 b.local=7");
    });
  });
});
