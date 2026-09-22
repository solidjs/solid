/**
 * Held truth (#3164) is masked from LANE passes only; every other deriving
 * reader follows A29 (ruled 2026-09-22; supersedes #3589's owner exemption).
 *
 * Confirming truth staged into a transaction that retains optimism
 * (`CONFIG_HELD_TRUTH`: an until()-stolen carrier, or a landing folded onto
 * an optimistic store family) is, to a memo or user effect, a staged value
 * like any other: the pass derives from it and is held with the transaction,
 * so it composes ONE staged world — never staged truth beside committed
 * neighbours (#3568's `1,2,3,HOLE len=4`). Untracked reads keep committed
 * (Rule 1), stale readers of a foreign transaction keep committed
 * (stale-of-foreign), latest() and until()'s predicate tunnel through.
 *
 * The one reader the mark gates is a lane pass, owning transaction or not: a
 * lane applies its frame display-ahead at the park, so a lane pass served the
 * truth would paint the confirmation beside the optimism it confirms
 * (`saving=true` beside the saved `v1` — GabbeV's #3164 tear). #3589 exempted
 * the pass that owns the fold's transaction from the mask, which fixed #3568
 * for the store's owning pass but let the OWNING lane pass paint `v1` while
 * `saving` was still true; the lane cells below pin that case.
 */
import {
  action,
  createEffect,
  createMemo,
  createOptimistic,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  getObserver,
  isPending,
  latest,
  refresh,
  until
} from "../src/index.js";
import { CONFIG_HELD_TRUTH } from "../src/core/constants.js";

afterEach(() => flush());

const tick = () => new Promise(r => setTimeout(r, 0));
const settle = async (n = 3) => {
  for (let i = 0; i < n; i++) {
    await tick();
    flush();
  }
};
/** A hold the test releases by hand. */
function hold() {
  let release!: () => void;
  const promise = new Promise<void>(r => (release = r));
  return { promise, release: async () => (release(), settle(4)) };
}

// ─── until()-stolen async-memo carrier (signal path) ─────────────────────────
//
// `stream` yields v0 then v1. The action writes `saving=true`, awaits
// `until(version >= 1)`, then stays open. When v1 lands, the flip steals the
// carrier's staged `{version: 1}` into the action's transaction T and arms
// CONFIG_HELD_TRUTH: committed 0, staged 1, held by T with `saving` live.
async function buildSteal(
  setup: (h: { stream: () => { version: number }; saving: () => boolean }) => void = () => {}
) {
  let landV1!: () => void;
  const v1 = new Promise<void>(r => (landV1 = r));
  const T = hold();
  let streamNode: any = null;
  let stream!: () => { version: number };
  let saving!: () => boolean;
  let setSaving!: (v: boolean) => void;
  let ownerLane!: () => boolean;
  let setOwnerLane!: (v: boolean) => void;
  const dispose = createRoot(d => {
    [saving, setSaving] = createOptimistic(false);
    [ownerLane, setOwnerLane] = createOptimistic(false);
    stream = createMemo(async function* () {
      streamNode = getObserver();
      yield { version: 0 };
      await v1;
      yield { version: 1 };
    });
    createRenderEffect(stream, () => {});
    // Readers that must exist BEFORE the hold (a reader created mid-hold is
    // born held into T by A29, which is a different cell).
    setup({ stream, saving });
    return d;
  });
  flush();
  await settle();
  action(function* () {
    setSaving(true);
    yield until(() => stream().version >= 1);
    // A write on T's lane AFTER the flip: the lane passes below re-run under
    // the transaction that holds the stolen truth.
    setOwnerLane(true);
    yield T.promise;
  })();
  flush();
  await settle();
  return {
    stream,
    saving,
    ownerLane,
    node: () => streamNode,
    landV1: async () => {
      landV1();
      await settle();
      await settle();
    },
    T,
    dispose
  };
}

describe("held truth is masked from lane passes only (until()-stolen carrier)", () => {
  it("precondition: the stolen landing is held truth — committed 0, staged 1, armed", async () => {
    const h = await buildSteal();
    await h.landV1();
    const n = h.node();
    expect(n._config & CONFIG_HELD_TRUTH).toBeTruthy();
    expect(n._pendingValue).toEqual({ version: 1 });
    expect(n._value).toEqual({ version: 0 });
    expect(h.stream().version).toBe(0); // Rule 1: untracked keeps committed
    expect(latest(() => h.stream().version)).toBe(1); // the tunnel
    expect(h.saving()).toBe(true);
    await h.T.release();
    expect(h.stream().version).toBe(1);
    expect(h.saving()).toBe(false);
    h.dispose();
  });

  it("the OWNING lane pass keeps committed v0 while saving is true (the case #3589 regressed), and sees v1 with saving=false in one frame at the reveal", async () => {
    const h = await buildSteal();
    const computed: string[] = [];
    const published: string[] = [];
    const d = createRoot(d => {
      // `ownerLane` is written by T AFTER the flip, so this memo re-runs after
      // the steal as a lane pass under the transaction that owns the stolen
      // truth — the pass #3589 exempted from the mask.
      const m = createMemo(() => {
        const v = `saving=${h.saving()} lane=${h.ownerLane()} v${h.stream().version}`;
        computed.push(v);
        return v;
      });
      createRenderEffect(m, v => {
        published.push(v);
      });
      return d;
    });
    flush();
    await settle();
    expect(published).toEqual(["saving=true lane=false v0"]);
    computed.length = 0;
    published.length = 0;
    await h.landV1();
    // #3589 painted `saving=true lane=true v1` here (display-ahead) — the
    // confirmation beside the optimism it confirms — while untracked reads
    // still served 0.
    expect(h.stream().version).toBe(0);
    expect(computed.at(-1)).toBe("saving=true lane=true v0");
    expect(published).toEqual(["saving=true lane=true v0"]);
    expect(computed).not.toContain("saving=true lane=true v1");
    published.length = 0;
    await h.T.release();
    // The reveal: v1, saving=false and the lane's revert arrive in ONE frame.
    expect(published).toEqual(["saving=false lane=false v1"]);
    d();
    h.dispose();
  });

  it("a FOREIGN lane pass likewise keeps committed v0, and is re-run to v1 by the reveal", async () => {
    const T3 = hold();
    const computed: string[] = [];
    const published: string[] = [];
    let setOpt3!: (v: boolean) => void;
    const h = await buildSteal(({ stream, saving }) => {
      let opt3: () => boolean;
      [opt3, setOpt3] = createOptimistic(false);
      // opt3 only: reading `saving` too would merge the lanes.
      const m = createMemo(() => {
        const v = `opt3=${opt3()} v${stream().version}`;
        computed.push(v);
        return v;
      });
      // The applied frame, with the state of `saving` at the moment it paints.
      createRenderEffect(m, v => {
        published.push(`${v} saving=${saving()}`);
      });
    });
    await h.landV1();
    computed.length = 0;
    published.length = 0;
    action(function* () {
      setOpt3(true);
      yield T3.promise;
    })();
    flush();
    await settle();
    expect(computed).toEqual(["opt3=true v0"]);
    expect(published).toEqual(["opt3=true v0 saving=true"]);
    expect(h.stream().version).toBe(0);
    // (Releasing T alone does not settle it while T3 is open — the lane
    // pass entangled the two; pre-existing on `next`, not this ruling's.)
    await h.T.release();
    await T3.release();
    expect(h.saving()).toBe(false);
    expect(h.stream().version).toBe(1);
    expect(published.at(-1)).toBe("opt3=false v1 saving=false");
    // v1 never painted beside saving=true.
    for (const f of published) expect(f).not.toMatch(/v1 saving=true/);
    h.dispose();
  });

  it("a fresh mainline memo created mid-hold derives the staged truth and is held (A29): latest() shows 1, nothing publishes before the reveal", async () => {
    const h = await buildSteal();
    await h.landV1();
    const computed: number[] = [];
    const published: number[] = [];
    let m!: () => number;
    const d = createRoot(d => {
      m = createMemo(() => {
        const v = h.stream().version;
        computed.push(v);
        return v;
      });
      createRenderEffect(m, v => {
        published.push(v);
      });
      return d;
    });
    flush();
    expect(computed).toEqual([1]);
    expect(published).toEqual([]);
    expect(latest(m)).toBe(1);
    expect(isPending(() => h.stream().version)).toBe(true);
    expect(h.stream().version).toBe(0);
    await h.T.release();
    expect(published).toEqual([1]);
    d();
    h.dispose();
  });

  it("a user effect re-run mid-hold by an unrelated write derives the staged truth and is held, not applied with committed", async () => {
    const [tick2, setTick2] = createSignal(0);
    const computed: string[] = [];
    const applied: string[] = [];
    const h = await buildSteal(({ stream }) => {
      createEffect(
        () => {
          const v = `v${stream().version}+t${tick2()}`;
          computed.push(v);
          return v;
        },
        v => {
          applied.push(v);
        }
      );
    });
    await h.landV1();
    computed.length = 0;
    applied.length = 0;
    setTick2(1);
    flush();
    // On `next` the mask served committed and the run applied `v0+t1` at
    // once — an effect applied mid-hold from the held world's inputs.
    expect(computed).toEqual(["v1+t1"]);
    expect(applied).toEqual([]);
    await h.T.release();
    expect(applied).toEqual(["v1+t1"]);
    h.dispose();
  });

  it("a stale reader of a foreign transaction keeps committed (stale-of-foreign) and replays at the reveal", async () => {
    const h = await buildSteal();
    await h.landV1();
    const published: number[] = [];
    const d = createRoot(d => {
      createRenderEffect(
        () => h.stream().version,
        v => {
          published.push(v);
        }
      );
      return d;
    });
    flush();
    expect(published).toEqual([0]);
    await h.T.release();
    expect(published).toEqual([0, 1]);
    d();
    h.dispose();
  });
});

// ─── store fold (#3568 shape), hold extended past the landing ────────────────
type Row = { id: number };
const render = (rows: Row[]) =>
  Array.from(rows, r => (r ? String(r.id) : "HOLE")).join(",") + " len=" + rows.length;

/** One optimistic push (1,2 → 1,2,3), a refetch landing 1,2,3,4 folded into
 * the action's transaction, and the action held open past the landing. */
async function buildFold(setup: (todos: Row[]) => void = () => {}) {
  let db: Row[] = [{ id: 1 }, { id: 2 }];
  const fetches: Array<() => void> = [];
  const frames: string[] = [];
  const T = hold();
  let todos!: Row[];
  let setTodos!: (fn: (d: Row[]) => void) => void;
  const dispose = createRoot(d => {
    [todos, setTodos] = createOptimisticStore<Row[]>(
      () => new Promise<Row[]>(res => fetches.push(() => res(db.map(t => ({ ...t }))))),
      []
    );
    createRenderEffect(
      () => render(todos),
      f => {
        frames.push(f);
      }
    );
    // Readers that must exist BEFORE the hold (see buildSteal).
    setup(todos);
    return d;
  });
  flush();
  fetches.shift()!();
  await settle();
  expect(frames.at(-1)).toBe("1,2 len=2");
  let confirm!: () => void;
  const confirmed = new Promise<void>(res => (confirm = res));
  action(function* () {
    setTodos(d => {
      d.push({ id: 3 });
    });
    yield confirmed;
    db = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
    refresh(todos as any);
    yield T.promise;
  })();
  await settle();
  expect(frames.at(-1)).toBe("1,2,3 len=3");
  confirm();
  await settle();
  fetches.shift()!();
  await settle();
  await settle();
  return {
    get todos() {
      return todos;
    },
    frames,
    T,
    dispose
  };
}

describe("held truth is masked from lane passes only (store fold, #3568 shape held past the landing)", () => {
  it("mid-hold: untracked keeps the optimistic frame, latest() shows the staged world whole", async () => {
    const h = await buildFold();
    expect(render(h.todos)).toBe("1,2,3 len=3");
    expect(latest(() => render(h.todos))).toBe("1,2,3,4 len=4");
    expect(h.frames.at(-1)).toBe("1,2,3 len=3");
    await h.T.release();
    expect(h.frames.at(-1)).toBe("1,2,3,4 len=4");
    expect(h.frames).not.toContain("1,2,3,HOLE len=4");
    h.dispose();
  });

  it("a fresh mainline memo created mid-hold composes one staged world (1,2,3,4 len=4, not 1,2,3,HOLE) and is held", async () => {
    const h = await buildFold();
    const computed: string[] = [];
    const published: string[] = [];
    let m!: () => string;
    const d = createRoot(d => {
      m = createMemo(() => {
        const v = render(h.todos);
        computed.push(v);
        return v;
      });
      createRenderEffect(m, v => {
        published.push(v);
      });
      return d;
    });
    flush();
    // #3589 left this torn: the fresh memo is not the fold's owning pass, so
    // it was served the landed `length` (through the superseded override)
    // with row 3 still masked to committed.
    expect(computed).toEqual(["1,2,3,4 len=4"]);
    expect(latest(m)).toBe("1,2,3,4 len=4");
    expect(published).toEqual([]);
    await h.T.release();
    expect(published).toEqual(["1,2,3,4 len=4"]);
    d();
    h.dispose();
  });

  it("a user effect reading row-then-length mid-hold gets row3=4 len=4 (one staged world) and is held", async () => {
    const [tick3, setTick3] = createSignal(0);
    const computed: string[] = [];
    const applied: string[] = [];
    const h = await buildFold(todos => {
      createEffect(
        () => {
          const r3 = todos[3];
          const l = todos.length;
          const v = `row3=${r3 ? r3.id : "HOLE"} len=${l} t${tick3()}`;
          computed.push(v);
          return v;
        },
        v => {
          applied.push(v);
        }
      );
    });
    computed.length = 0;
    applied.length = 0;
    setTick3(1);
    flush();
    // #3589: `row3=HOLE len=4` — row 3 read committed (a mainline pass, not
    // the fold's owner), then `length` read the landed truth.
    expect(computed).toEqual(["row3=4 len=4 t1"]);
    expect(applied).toEqual([]);
    await h.T.release();
    expect(applied).toEqual(["row3=4 len=4 t1"]);
    h.dispose();
  });

  it("a user effect reading length-then-row mid-hold likewise gets len=4 row3=4", async () => {
    const [tick2, setTick2] = createSignal(0);
    const computed: string[] = [];
    const h = await buildFold(todos => {
      createEffect(
        () => {
          const l = todos.length;
          const r3 = todos[3];
          const v = `len=${l} row3=${r3 ? r3.id : "HOLE"} t${tick2()}`;
          computed.push(v);
          return v;
        },
        () => {}
      );
    });
    computed.length = 0;
    setTick2(1);
    flush();
    expect(computed).toEqual(["len=4 row3=4 t1"]);
    await h.T.release();
    h.dispose();
  });

  it("a FOREIGN lane pass keeps the committed (optimistic) frame: 1,2,3 len=3", async () => {
    const T3 = hold();
    const computed: string[] = [];
    const published: string[] = [];
    let setOpt3!: (v: boolean) => void;
    const h = await buildFold(todos => {
      let opt3: () => boolean;
      [opt3, setOpt3] = createOptimistic(false);
      const m = createMemo(() => {
        const v = `opt3=${opt3()} ${render(todos)}`;
        computed.push(v);
        return v;
      });
      createRenderEffect(m, v => {
        published.push(v);
      });
    });
    computed.length = 0;
    published.length = 0;
    action(function* () {
      setOpt3(true);
      yield T3.promise;
    })();
    flush();
    await settle();
    expect(computed).toEqual(["opt3=true 1,2,3 len=3"]);
    expect(published).toEqual(["opt3=true 1,2,3 len=3"]);
    expect(computed).not.toContain("opt3=true 1,2,3,HOLE len=4");
    await h.T.release();
    await T3.release();
    expect(published.at(-1)).toBe("opt3=false 1,2,3,4 len=4");
    for (const f of published) expect(f).not.toContain("HOLE");
    h.dispose();
  });

  it("the OWNING lane pass (a lane write after the landing folded) keeps the committed frame: len=3, no row 3", async () => {
    let db: Row[] = [{ id: 1 }, { id: 2 }];
    const fetches: Array<() => void> = [];
    const published: string[] = [];
    const computed: string[] = [];
    const T = hold();
    let todos!: Row[];
    let setTodos!: (fn: (d: Row[]) => void) => void;
    let setOpt2!: (v: boolean) => void;
    const dispose = createRoot(d => {
      [todos, setTodos] = createOptimisticStore<Row[]>(
        () => new Promise<Row[]>(res => fetches.push(() => res(db.map(t => ({ ...t }))))),
        []
      );
      let opt2: () => boolean;
      [opt2, setOpt2] = createOptimistic(false);
      const m = createMemo(() => {
        const r3 = todos[3];
        const v = `opt2=${opt2()} len=${todos.length} row3=${r3 ? r3.id : "HOLE"}`;
        computed.push(v);
        return v;
      });
      createRenderEffect(m, v => {
        published.push(v);
      });
      return d;
    });
    flush();
    fetches.shift()!();
    await settle();
    let confirm!: () => void;
    const confirmed = new Promise<void>(res => (confirm = res));
    let landed!: () => void;
    const landedP = new Promise<void>(res => (landed = res));
    action(function* () {
      setTodos(d => {
        d.push({ id: 3 });
      });
      yield confirmed;
      db = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
      refresh(todos as any);
      yield landedP;
      setOpt2(true); // a lane pass under the owning transaction, truth held
      yield T.promise;
    })();
    await settle();
    confirm();
    await settle();
    fetches.shift()!();
    await settle();
    await settle();
    computed.length = 0;
    published.length = 0;
    landed();
    await settle();
    await settle();
    // The committed frame is coherent (len=3, index 3 absent); the lane
    // never composes the landed length with a committed row set.
    expect(computed).toEqual(["opt2=true len=3 row3=HOLE"]);
    expect(published).toEqual(["opt2=true len=3 row3=HOLE"]);
    expect(computed).not.toContain("opt2=true len=4 row3=HOLE");
    await T.release();
    expect(published.at(-1)).toBe("opt2=false len=4 row3=4");
    dispose();
  });
});

// ─── GabbeV's object-keys shape (#3164) ──────────────────────────────────────
describe("held truth is masked from lane passes only (GabbeV's session fold, #3164)", () => {
  type Session =
    | { status: "signedOut" | "signingIn"; account: { email: string }; user?: undefined }
    | { status: "authenticated"; user: { name: string }; account?: undefined };
  const rs = (s: Session) => `status=${s.status} account=${!!s.account} user=${!!s.user}`;

  it("deriving readers compose the authenticated world whole; lane passes keep signingIn whole", async () => {
    let resolveAuth!: () => void;
    const authenticated = new Promise<void>(r => (resolveAuth = r));
    const vault = hold();
    const T3 = hold();
    const renderLog: string[] = [];
    const ownerLane: string[] = [];
    const foreignLane: string[] = [];
    const mainMemoComp: string[] = [];
    let state!: { session: Session };
    let setState!: (fn: (s: { session: Session }) => void) => void;
    let signIn!: () => Promise<unknown>;
    let setOpt2!: (v: boolean) => void;
    let setOpt3!: (v: boolean) => void;
    const [tick, setTick] = createSignal(0);
    let mainMemo!: () => string;
    const dispose = createRoot(d => {
      [state, setState] = createOptimisticStore<{ session: Session }>(
        async function* () {
          yield { session: { status: "signedOut", account: { email: "g@x" } } };
          await authenticated;
          yield { session: { status: "authenticated", user: { name: "Gabriel" } } };
        },
        { session: { status: "signedOut", account: { email: "g@x" } } }
      );
      let opt2: () => boolean, opt3: () => boolean;
      [opt2, setOpt2] = createOptimistic(false);
      [opt3, setOpt3] = createOptimistic(false);
      signIn = action(function* () {
        setState(store => {
          store.session.status = "signingIn";
        });
        yield until(() => state.session.status === "authenticated");
        setOpt2(true); // owning lane pass after the fold
        yield vault.promise;
      });
      createRenderEffect(
        () => rs(state.session),
        v => {
          renderLog.push(v);
        }
      );
      const om = createMemo(() => `opt2=${opt2()} ${rs(state.session)}`);
      createRenderEffect(om, v => {
        ownerLane.push(v);
      });
      const fm = createMemo(() => `opt3=${opt3()} ${rs(state.session)}`);
      createRenderEffect(fm, v => {
        foreignLane.push(v);
      });
      mainMemo = createMemo(() => {
        const v = `${rs(state.session)} t${tick()}`;
        mainMemoComp.push(v);
        return v;
      });
      createRenderEffect(mainMemo, () => {});
      return d;
    });
    flush();
    await settle();
    const done = signIn();
    flush();
    await settle();
    expect(renderLog.at(-1)).toBe("status=signingIn account=true user=false");
    ownerLane.length = 0;
    foreignLane.length = 0;
    mainMemoComp.length = 0;
    resolveAuth();
    await settle();
    await settle();
    // Untracked and the render effect keep the optimistic frame.
    expect(rs(state.session)).toBe("status=signingIn account=true user=false");
    expect(renderLog.at(-1)).toBe("status=signingIn account=true user=false");
    // The owning lane pass: signingIn WHOLE (committed), never
    // `authenticated account=true user=false` (the #3164 tear #3589 left in
    // the owner's pass).
    expect(ownerLane).toEqual(["opt2=true status=signingIn account=true user=false"]);
    // A mainline memo re-run mid-hold derives the authenticated world whole
    // and latest() shows it.
    setTick(1);
    flush();
    expect(mainMemoComp.at(-1)).toBe("status=authenticated account=false user=true t1");
    expect(mainMemoComp).not.toContain("status=authenticated account=true user=false t1");
    expect(latest(mainMemo)).toBe("status=authenticated account=false user=true t1");
    // A foreign lane pass: signingIn whole.
    action(function* () {
      setOpt3(true);
      yield T3.promise;
    })();
    flush();
    await settle();
    expect(foreignLane).toEqual(["opt3=true status=signingIn account=true user=false"]);
    await vault.release();
    await done;
    await T3.release();
    expect(renderLog.at(-1)).toBe("status=authenticated account=false user=true");
    for (const f of renderLog) {
      expect(f).not.toContain("status=authenticated account=true");
      expect(f).not.toContain("status=signingIn account=false");
    }
    dispose();
  });
});

// ─── S1e (out of scope here; pending GabbeV) ─────────────────────────────────
// TODO(S1e, pending GabbeV): a lane pass reading a PLAIN held sync memo (not
// held truth) is served the memo's staged value — `gatedRead` excludes `_fn`
// nodes and `laneReadsCommitted` only catches override / lane-assigned /
// pending owners — so the lane paints `dbl=2` display-ahead while untracked
// `dbl()` is 0. Whether the lane-only mask should generalize to every held
// memo a lane pass reads is a separate ruling; this documents the current
// behaviour so the change, if ruled, is visible.
describe.skip("S1e — lane passes reading a plain held sync memo (current behaviour, pending ruling)", () => {
  it("owner and foreign lane passes are served the held memo's staged value display-ahead", async () => {
    const [plain, setPlain] = createSignal(0);
    const T = hold();
    const T3 = hold();
    const pubO: string[] = [];
    const pubF: string[] = [];
    let setOpt2!: (v: boolean) => void;
    let setOpt3!: (v: boolean) => void;
    let setSaving!: (v: boolean) => void;
    let dbl!: () => number;
    const dispose = createRoot(d => {
      [, setSaving] = createOptimistic(false);
      let opt2: () => boolean, opt3: () => boolean;
      [opt2, setOpt2] = createOptimistic(false);
      [opt3, setOpt3] = createOptimistic(false);
      dbl = createMemo(() => plain() * 2);
      createRenderEffect(dbl, () => {});
      const mo = createMemo(() => `opt2=${opt2()} dbl=${dbl()}`);
      createRenderEffect(mo, v => {
        pubO.push(v);
      });
      const mf = createMemo(() => `opt3=${opt3()} dbl=${dbl()}`);
      createRenderEffect(mf, v => {
        pubF.push(v);
      });
      return d;
    });
    flush();
    pubO.length = pubF.length = 0;
    action(function* () {
      setSaving(true);
      setPlain(1);
      yield Promise.resolve();
      setOpt2(true);
      yield T.promise;
    })();
    flush();
    await settle();
    expect(dbl()).toBe(0);
    expect(pubO).toEqual(["opt2=true dbl=2"]); // current: staged, display-ahead
    action(function* () {
      setOpt3(true);
      yield T3.promise;
    })();
    flush();
    await settle();
    expect(pubF).toEqual(["opt3=true dbl=2"]); // current: staged, display-ahead
    await T.release();
    await T3.release();
    dispose();
  });
});
