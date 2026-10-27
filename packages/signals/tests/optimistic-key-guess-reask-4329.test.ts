/**
 * #4329: a per-key guess on an optimistic store made inside a pending action
 * survives a re-ask of the store that lands while the action is still out.
 *
 * D-34: a different truth corrects the graph now and the screen at the
 * commit. The derive writes the answer through its draft (`d.length = 0;
 * d.push(...rows)`), so the guessed row's new object is paired with that row
 * by key and the guess stays over it: the screen keeps showing the guess
 * until the action that made it settles. D-33: per-key guesses are
 * independent, so one row's settled action does not carry another's guess.
 * `createOptimistic` (the signal form) already behaves this way.
 */
import { describe, expect, it } from "vitest";
import {
  action,
  createOptimistic,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  flush,
  refresh,
  type Refreshable
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 3; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};
const defer = <T = void>() => {
  let res!: (v: T) => void;
  const p = new Promise<T>(a => {
    res = a;
  });
  return { p, res };
};

type Issue = { id: number; assignee: string | null };

function setup() {
  const fetches: ReturnType<typeof defer<Issue[]>>[] = [];
  const fetchIssues = () => {
    const d = defer<Issue[]>();
    fetches.push(d);
    return d.p;
  };
  const frames: string[] = [];
  let store!: Refreshable<Issue[]>;
  let setStore!: (fn: (d: Issue[]) => void) => void;
  createRoot(() => {
    [store, setStore] = createOptimisticStore<Issue[]>(async d => {
      const r = await fetchIssues();
      d.length = 0;
      d.push(...r);
    }, []);
    createRenderEffect(
      () => store.map(i => `${i.id}:${i.assignee}`).join(" "),
      v => void frames.push(v)
    );
  });
  return {
    fetches,
    frames,
    get store() {
      return store;
    },
    setStore,
    screen: () => frames[frames.length - 1]
  };
}

describe("#4329 per-key optimistic guess across a re-ask (D-34)", () => {
  it("the guess stays on screen while its action is pending through a re-ask landing", async () => {
    const h = setup();
    await tick();
    h.fetches[0].res([
      { id: 1, assignee: null },
      { id: 3, assignee: null }
    ]);
    await tick();
    expect(h.screen()).toBe("1:null 3:null");

    const save = defer();
    const assign = action(function* () {
      h.setStore(d => {
        d[1].assignee = "ann";
      });
      yield save.p;
    });
    assign();
    await tick();
    expect(h.screen()).toBe("1:null 3:ann");

    refresh(h.store);
    await tick();
    expect(h.screen()).toBe("1:null 3:ann");
    const guessed = h.store[1];

    h.fetches.at(-1)!.res([
      { id: 1, assignee: null },
      { id: 3, assignee: null }
    ]);
    await tick();
    // The truth differs from the guess: the screen and untracked reads keep
    // the guess until the action commits, and the guessed row keeps its
    // identity (the truth's object for its key is paired with it).
    expect(h.screen()).toBe("1:null 3:ann");
    expect(h.store[1].assignee).toBe("ann");
    expect(h.store[1]).toBe(guessed);

    save.res();
    await tick();
    // The action committed: the truth beneath shows.
    expect(h.screen()).toBe("1:null 3:null");
  });

  it("the guess stays, then the server's committed value shows once save settles and the next truth lands", async () => {
    const h = setup();
    await tick();
    h.fetches[0].res([
      { id: 1, assignee: null },
      { id: 3, assignee: null }
    ]);
    await tick();

    const save = defer();
    const assign = action(function* () {
      h.setStore(d => {
        d[1].assignee = "ann";
      });
      yield save.p;
      refresh(h.store);
    });
    assign();
    await tick();
    expect(h.screen()).toBe("1:null 3:ann");

    // A re-ask from elsewhere (a filter switched away and back) lands the
    // old truth while the save is out.
    refresh(h.store);
    await tick();
    h.fetches.at(-1)!.res([
      { id: 1, assignee: null },
      { id: 3, assignee: null }
    ]);
    await tick();
    expect(h.screen()).toBe("1:null 3:ann");

    // The save answers; the action re-asks and holds on the new truth.
    save.res();
    await tick();
    expect(h.screen()).toBe("1:null 3:ann");
    h.fetches.at(-1)!.res([
      { id: 1, assignee: null },
      { id: 3, assignee: "ann" }
    ]);
    await tick();
    expect(h.screen()).toBe("1:null 3:ann");
    expect(h.frames.slice(h.frames.indexOf("1:null 3:ann"))).not.toContain("1:null 3:null");
  });

  it("two rows' guesses stay independent: only the pending row keeps its guess through the re-ask (D-33)", async () => {
    const h = setup();
    await tick();
    h.fetches[0].res([
      { id: 1, assignee: null },
      { id: 3, assignee: null }
    ]);
    await tick();

    const saveA = defer();
    const saveB = defer();
    const assign = (i: number, who: string, save: { p: Promise<void> }) =>
      action(function* () {
        h.setStore(d => {
          d[i].assignee = who;
        });
        yield save.p;
      })();
    assign(0, "bob", saveA);
    await tick();
    assign(1, "ann", saveB);
    await tick();
    expect(h.screen()).toBe("1:bob 3:ann");

    // Row 1's action settles before the re-ask: its guess reverts.
    saveA.res();
    await tick();
    expect(h.screen()).toBe("1:null 3:ann");

    refresh(h.store);
    await tick();
    h.fetches.at(-1)!.res([
      { id: 1, assignee: "bob" },
      { id: 3, assignee: null }
    ]);
    await tick();
    // Row 1 carries no guess: its new truth shows now. Row 3's guess stays
    // until its own action settles.
    expect(h.screen()).toBe("1:bob 3:ann");

    saveB.res();
    await tick();
    expect(h.screen()).toBe("1:bob 3:null");
  });

  it("two rows' guesses stay independent while both actions are pending across the re-ask", async () => {
    const h = setup();
    await tick();
    h.fetches[0].res([
      { id: 1, assignee: null },
      { id: 3, assignee: null }
    ]);
    await tick();

    const saveA = defer();
    const saveB = defer();
    const assign = (i: number, who: string, save: { p: Promise<void> }) =>
      action(function* () {
        h.setStore(d => {
          d[i].assignee = who;
        });
        yield save.p;
      })();
    assign(0, "bob", saveA);
    await tick();
    assign(1, "ann", saveB);
    await tick();

    refresh(h.store);
    await tick();
    h.fetches.at(-1)!.res([
      { id: 1, assignee: null },
      { id: 3, assignee: null }
    ]);
    await tick();
    expect(h.screen()).toBe("1:bob 3:ann");

    saveA.res();
    await tick();
    expect(h.screen()).toBe("1:null 3:ann");

    saveB.res();
    await tick();
    expect(h.screen()).toBe("1:null 3:null");
  });

  for (const replace of [false, true]) {
    it(`nested list (${replace ? "`d.issues = rows`" : "`d.issues.length = 0; d.issues.push(...)`"}) keeps the guess through the re-ask`, async () => {
      const fetches: ReturnType<typeof defer<Issue[]>>[] = [];
      const frames: string[] = [];
      let store!: Refreshable<{ issues: Issue[] }>;
      let setStore!: (fn: (d: { issues: Issue[] }) => void) => void;
      createRoot(() => {
        [store, setStore] = createOptimisticStore<{ issues: Issue[] }>(
          async d => {
            const p = defer<Issue[]>();
            fetches.push(p);
            const r = await p.p;
            if (replace) d.issues = r;
            else {
              d.issues.length = 0;
              d.issues.push(...r);
            }
          },
          { issues: [] }
        );
        createRenderEffect(
          () => store.issues.map(i => `${i.id}:${i.assignee}`).join(" "),
          v => void frames.push(v)
        );
      });
      await tick();
      fetches[0].res([
        { id: 1, assignee: null },
        { id: 3, assignee: null }
      ]);
      await tick();
      expect(frames.at(-1)).toBe("1:null 3:null");

      const save = defer();
      action(function* () {
        setStore(d => {
          d.issues[1].assignee = "ann";
        });
        yield save.p;
      })();
      await tick();
      refresh(store);
      await tick();
      fetches.at(-1)!.res([
        { id: 1, assignee: null },
        { id: 3, assignee: null }
      ]);
      await tick();
      expect(frames.at(-1)).toBe("1:null 3:ann");

      save.res();
      await tick();
      expect(frames.at(-1)).toBe("1:null 3:null");
    });
  }

  it("createOptimistic (signal form) parity: the guess stays through a re-ask landing", async () => {
    const fetches: ReturnType<typeof defer<string | null>>[] = [];
    const frames: string[] = [];
    let value!: Refreshable<() => string | null>;
    let setValue!: (v: string | null) => void;
    createRoot(() => {
      [value, setValue] = createOptimistic(() => {
        const d = defer<string | null>();
        fetches.push(d);
        return d.p;
      });
      createRenderEffect(
        () => `3:${value()}`,
        v => void frames.push(v)
      );
    });
    await tick();
    fetches[0].res(null);
    await tick();
    expect(frames.at(-1)).toBe("3:null");

    const save = defer();
    action(function* () {
      setValue("ann");
      yield save.p;
    })();
    await tick();
    expect(frames.at(-1)).toBe("3:ann");

    refresh(value);
    await tick();
    fetches.at(-1)!.res(null);
    await tick();
    expect(frames.at(-1)).toBe("3:ann");

    save.res();
    await tick();
    expect(frames.at(-1)).toBe("3:null");
  });
});
