/**
 * SPEC TESTS — see packages/signals/docs/SPEC-ASYNC-SEMANTICS.md.
 *
 * These pin *ruled* semantics (Tier A). Changing an expectation here requires
 * a design decision recorded in the spec document — never "update
 * expectations" to make an implementation change pass.
 *
 * Verdicts pinned in this file (maintainer, 2026-07-06): B1, B2, B3, B5 —
 * promoted to A13–A16.
 */
import { describe, expect, it } from "vitest";
import {
  action,
  createLoadingBoundary,
  createMemo,
  createOptimistic,
  createOptimisticStore,
  createProjection,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  isPending,
  latest,
  refresh,
  type SourceAccessor
} from "../src/index.js";

function deferredFetcher<T>(compute: (arg: number) => T) {
  const resolvers: Array<(v: T) => void> = [];
  return {
    fetch(arg: number): Promise<T> {
      return new Promise<T>(r => resolvers.push(() => r(compute(arg))));
    },
    resolveAll(): void {
      const pending = resolvers.splice(0);
      for (const r of pending) r(undefined as never);
    }
  };
}

const settle = async () => {
  // Two microtask turns: promise resolution + async-write propagation.
  await Promise.resolve();
  await Promise.resolve();
  flush();
};

describe("A13 (was B1): resting optimistic node ≡ plain async memo", () => {
  // A createOptimistic node with no active override must be observationally
  // identical to a plain async memo: same values, same isPending/latest
  // verdicts, at every checkpoint of a refetch cycle — both before any
  // override was ever written and after a full override cycle reverted.
  it("matches a plain async memo through initial load and refresh, before and after an override cycle", async () => {
    const [tick, setTick] = createSignal(1);
    const plainFetch = deferredFetcher((t: number) => t * 10);
    const optFetch = deferredFetcher((t: number) => t * 10);

    let plain!: SourceAccessor<number>;
    let opt!: SourceAccessor<number>;
    let setOpt!: (v: number) => void;

    createRoot(() => {
      plain = createMemo(() => plainFetch.fetch(tick()));
      [opt, setOpt] = createOptimistic(() => optFetch.fetch(tick()));
      createRenderEffect(plain, () => {});
      createRenderEffect(opt, () => {});
    });
    flush();

    const observe = () => ({
      plain: [latest(plain), isPending(plain)],
      opt: [latest(opt), isPending(opt)]
    });
    const expectEquivalent = () => {
      const o = observe();
      expect(o.opt).toEqual(o.plain);
    };

    // Initial load resolves.
    plainFetch.resolveAll();
    optFetch.resolveAll();
    await settle();
    expect(plain()).toBe(10);
    expect(opt()).toBe(10);
    expectEquivalent();

    // Refetch via source change: both report pending with the stale value.
    setTick(2);
    flush();
    expectEquivalent();
    expect(isPending(opt)).toBe(true);

    plainFetch.resolveAll();
    optFetch.resolveAll();
    await settle();
    expect(opt()).toBe(20);
    expectEquivalent();

    // Full override cycle on the optimistic node: write, resolve, revert.
    setTick(3);
    setOpt(30);
    flush();
    expect(opt()).toBe(30); // override visible immediately
    plainFetch.resolveAll();
    optFetch.resolveAll();
    await settle();
    expect(opt()).toBe(30);
    expect(plain()).toBe(30);

    // Now *resting* again — must still behave exactly like the plain memo.
    expectEquivalent();
    expect(isPending(opt)).toBe(false);

    refresh(opt);
    refresh(plain);
    flush();
    expectEquivalent();
    // Question-scoped pending (re-ruled 2026-07-13): refresh() with unchanged
    // inputs is a re-ask of the same question — the shown value still answers
    // it, so the quiet refetch reads NOT pending (both forms, equivalently).
    expect(isPending(opt)).toBe(false);

    plainFetch.resolveAll();
    optFetch.resolveAll();
    await settle();
    expect(opt()).toBe(30);
    expectEquivalent();
    expect(isPending(opt)).toBe(false);
  });
});

describe("A14 (was B2): companion lanes flush independently of the owner's async", () => {
  // The isPending()/latest() companion nodes get child lanes that do NOT merge
  // with the owner's lane: an isPending effect (spinner) must fire while the
  // owner's async is still in flight, not after it settles.
  //
  // Re-scoped by the 2026-07-07c mask ruling: an optimistic write no longer
  // produces a `true` verdict (the override masks its own confirming fetch),
  // so the independent-flush property is pinned on a PLAIN refetch — the
  // spinner fires while the fetch is in flight, before anything commits.
  it("isPending effect fires true before the owner's async resolves", async () => {
    const [id, setId] = createSignal(1);
    const fetcher = deferredFetcher((t: number) => t * 10);
    const pendingLog: boolean[] = [];
    const valueLog: number[] = [];

    let data!: SourceAccessor<number>;
    let setData!: (v: number) => void;
    createRoot(() => {
      [data, setData] = createOptimistic(() => fetcher.fetch(id()));
      const pending = createMemo(() => isPending(data));
      createRenderEffect(pending, v => {
        pendingLog.push(v);
      });
      createRenderEffect(data, v => {
        valueLog.push(v);
      });
    });
    flush();
    fetcher.resolveAll();
    await settle();
    expect(valueLog).toEqual([10]);
    expect(pendingLog).toEqual([false]);

    // Plain source write: the refetch for id=2 is in flight, no override.
    // The spinner fires without waiting for the fetch — this is the whole
    // point of the companion child lane — while the rendered value holds.
    setId(2);
    flush();
    expect(pendingLog).toEqual([false, true]);
    expect(valueLog).toEqual([10]);

    fetcher.resolveAll();
    await settle();
    expect(pendingLog).toEqual([false, true, false]);
    expect(data()).toBe(20);

    // Question-scoped contrast (re-ruled 2026-07-13, supersedes the A20 mask
    // pin): the same shape with an optimistic write still surfaces true — the
    // override displays (honest mixed state) but is verdict-inert, and the
    // id=3 question change pends the slot until its answer reveals.
    setId(3);
    setData(30);
    flush();
    expect(pendingLog).toEqual([false, true, false, true]);
    expect(valueLog).toEqual([10, 20, 30]);
    fetcher.resolveAll();
    await settle();
    expect(pendingLog).toEqual([false, true, false, true, false]);
    expect(data()).toBe(30);
  });
});

describe("A15 (was B3): overlapping transitions settle as one unit", () => {
  // Transition merging is graph-driven: writes whose async work is observed by
  // a *shared* reader join one transition and settle together; writes on
  // fully disjoint graphs keep independent transitions and settle
  // independently. Both halves are the spec.
  it("a shared reader forces one settle point: nothing commits until both asyncs resolve", async () => {
    const [a, setA] = createSignal(1);
    const [b, setB] = createSignal(1);
    const fetchA = deferredFetcher((t: number) => t * 10);
    const fetchB = deferredFetcher((t: number) => t * 100);
    const log: string[] = [];

    createRoot(() => {
      const ma = createMemo(() => fetchA.fetch(a()));
      const mb = createMemo(() => fetchB.fetch(b()));
      // The shared reader entangles both sources' transitions.
      const joined = createMemo(() => `${ma()}|${mb()}`);
      createRenderEffect(joined, v => {
        log.push(v);
      });
    });
    flush();
    fetchA.resolveAll();
    fetchB.resolveAll();
    await settle();
    expect(log).toEqual(["10|100"]);
    log.length = 0;

    // Write A (async in flight), then write B before A resolves.
    setA(2);
    flush();
    setB(2);
    flush();

    // A's fetch resolves first. The joint view must NOT tear to "20|100":
    // the merged transition is still blocked on B.
    fetchA.resolveAll();
    await settle();
    expect(log).toEqual([]);

    // B resolves: one commit, both new values at once.
    fetchB.resolveAll();
    await settle();
    expect(log).toEqual(["20|200"]);
  });

  it("disjoint graphs keep independent transitions: each settles on its own", async () => {
    const [a, setA] = createSignal(1);
    const [b, setB] = createSignal(1);
    const fetchA = deferredFetcher((t: number) => t * 10);
    const fetchB = deferredFetcher((t: number) => t * 100);
    const log: string[] = [];

    createRoot(() => {
      const ma = createMemo(() => fetchA.fetch(a()));
      const mb = createMemo(() => fetchB.fetch(b()));
      createRenderEffect(ma, v => {
        log.push(`a=${v}`);
      });
      createRenderEffect(mb, v => {
        log.push(`b=${v}`);
      });
    });
    flush();
    fetchA.resolveAll();
    fetchB.resolveAll();
    await settle();
    expect(log.sort()).toEqual(["a=10", "b=100"]);
    log.length = 0;

    setA(2);
    flush();
    setB(2);
    flush();

    // No shared reader: A's update does not wait for B's.
    fetchA.resolveAll();
    await settle();
    expect(log).toEqual(["a=20"]);

    fetchB.resolveAll();
    await settle();
    expect(log).toEqual(["a=20", "b=200"]);
  });
});

describe("A16 (was B5): isPending never throws in untracked contexts", () => {
  it("returns false when the thunk throws a real error", () => {
    expect(
      isPending(() => {
        throw new Error("boom");
      })
    ).toBe(false);
  });

  it("returns false for an uninitialized async source (initial load is not pending)", async () => {
    const fetcher = deferredFetcher((t: number) => t);
    let data!: SourceAccessor<number>;
    createRoot(() => {
      data = createMemo(() => fetcher.fetch(1));
      createRenderEffect(data, () => {});
    });
    flush();

    // Uninitialized: read(data) throws NotReadyError; isPending swallows it.
    expect(isPending(data)).toBe(false);

    fetcher.resolveAll();
    await settle();
    expect(isPending(data)).toBe(false);
    expect(data()).toBe(1);
  });

  // B5a carve-out (pinned as current behavior): in *tracked* contexts the
  // NotReadyError of an uninitialized source propagates, so a memo computing
  // isPending participates in loading boundaries like any other async read.
  it("tracked isPending of an uninitialized source participates in a loading boundary (B5a)", async () => {
    const fetcher = deferredFetcher((t: number) => t * 10);
    let result: unknown;

    createRoot(() => {
      const data = createMemo(() => fetcher.fetch(1));
      const pending = createMemo(() => isPending(data));
      const boundary = createLoadingBoundary(
        () => `pending:${pending()}`,
        () => "loading"
      );
      createRenderEffect(
        () => (result = boundary()),
        () => {}
      );
    });
    flush();
    expect(result).toBe("loading");

    fetcher.resolveAll();
    await settle();
    expect(result).toBe("pending:false");
  });
});

describe("A17 (was C4): an active override is THE value — every reader, until its async settles", () => {
  // Maintainer ruling (2026-07-06): "override should always be read if
  // present.. it is the optimistic future value, it is both immediate and is
  // the future until we know otherwise." That must not depend on whether the
  // node's transition got entangled (merged) with other async work. The
  // override holds while the node's own async is still in flight and reverts
  // to the fresh value only when the owning transition completes.
  //
  // Before the fix, transitionComplete excluded a node pending on ITS OWN
  // fetch from blocking completion (`_error.source !== node`), so an
  // entangled transition completed on the first flush and silently dropped
  // the override — the ambient read returned the committed value while
  // tracked readers had seen the override for one tick.
  it("entangled graph: ambient and tracked reads both hold the override until completion", async () => {
    const [id, setId] = createSignal(1);
    const [other, setOther] = createSignal(1);
    const dataFetch = deferredFetcher((t: number) => t * 10);
    const otherFetch = deferredFetcher((t: number) => t * 100);
    const log: string[] = [];

    let data!: SourceAccessor<number>;
    let setData!: (v: number) => void;
    createRoot(() => {
      [data, setData] = createOptimistic(() => dataFetch.fetch(id()));
      const mOther = createMemo(() => otherFetch.fetch(other()));
      const joined = createMemo(() => `${data()}|${mOther()}`);
      createRenderEffect(joined, v => {
        log.push(v);
      });
    });
    flush();
    dataFetch.resolveAll();
    otherFetch.resolveAll();
    await settle();
    log.length = 0;

    // Both sources refetch (entangled through `joined`) + user override.
    setId(2);
    setOther(2);
    setData(99);
    flush();
    // Tracked (lane-routed) reader sees the override...
    expect(log).toEqual(["99|100"]);
    // ...and so does the ambient read — same as the simple graph (B4 test).
    expect(data()).toBe(99);

    dataFetch.resolveAll();
    await settle();

    otherFetch.resolveAll();
    await settle();
    // Everything settled: reverted to the fresh async value everywhere.
    expect(data()).toBe(20);
    expect(log[log.length - 1]).toBe("20|200");
  });

  // No-tearing is enforced at the EFFECT level, not the read level (ruling
  // 2026-07-07): async derived FROM the optimistic value holds the lane's
  // render effects — the rendered view moves as one unit — while direct reads
  // (ambient included) return the override immediately ("direct read shows
  // optimistic, effect waits"). The real-world CategoryDisplay/News-Finance
  // suites in createOptimistic.test.ts pin this extensively; this is the
  // minimal spec statement.
  it("downstream async: direct read shows the override immediately, lane effects wait for it", async () => {
    const [id, setId] = createSignal(1);
    const dataFetch = deferredFetcher((t: number) => t * 10);
    const derivedFetch = deferredFetcher((t: number) => `derived(${t})`);
    const valueLog: number[] = [];
    const derivedLog: string[] = [];

    let data!: SourceAccessor<number>;
    let setData!: (v: number) => void;
    createRoot(() => {
      [data, setData] = createOptimistic(() => dataFetch.fetch(id()));
      const derived = createMemo(() => derivedFetch.fetch(data()));
      createRenderEffect(data, v => {
        valueLog.push(v);
      });
      createRenderEffect(derived, v => {
        derivedLog.push(v);
      });
    });
    flush();
    dataFetch.resolveAll();
    await settle();
    derivedFetch.resolveAll();
    await settle();
    valueLog.length = 0;
    derivedLog.length = 0;

    // Refetch + override: derived(99) is now in flight in the override's lane.
    setId(2);
    setData(99);
    flush();
    // Direct read shows the override immediately...
    expect(data()).toBe(99);
    // ...but the lane holds BOTH its effects (value and derived move together).
    expect(valueLog).toEqual([]);
    expect(derivedLog).toEqual([]);

    // Downstream async for the optimistic view resolves: the view appears
    // atomically — no tearing, no window where value updated but derived hadn't.
    derivedFetch.resolveAll();
    await settle();
    expect(valueLog).toEqual([99]);
    expect(derivedLog).toEqual(["derived(99)"]);

    // Real refetch lands: corrected value flows through the same unit.
    dataFetch.resolveAll();
    await settle();
    derivedFetch.resolveAll();
    await settle();
    expect(data()).toBe(20);
    expect(valueLog).toEqual([99, 20]);
    expect(derivedLog).toEqual(["derived(99)", "derived(20)"]);
  });

  it("simple graph: override visible ambiently until its own fetch settles", async () => {
    const [id, setId] = createSignal(1);
    const fetcher = deferredFetcher((t: number) => t * 10);

    let data!: SourceAccessor<number>;
    let setData!: (v: number) => void;
    createRoot(() => {
      [data, setData] = createOptimistic(() => fetcher.fetch(id()));
      createRenderEffect(data, () => {});
    });
    flush();
    fetcher.resolveAll();
    await settle();
    expect(data()).toBe(10);

    setId(2);
    setData(99);
    flush();
    expect(data()).toBe(99);

    fetcher.resolveAll();
    await settle();
    expect(data()).toBe(20);
  });
});

describe("A18 (was B4): an override's lifetime is bound to its own async source, not its transition", () => {
  // Maintainer ruling (2026-07-07): "overrides clear when their async source
  // resolves.. otherwise unrelated parts of a transition can get held up
  // waiting for other async to resolve, especially if the optimistic value
  // needs correction and triggers further async." The authoritative value
  // wins the moment it arrives; the correction cascade (and any async it
  // triggers) must not wait for strangers in a merged transition.
  it("entangled: own-source resolution clears the override while an unrelated fetch is still pending", async () => {
    const [id, setId] = createSignal(1);
    const [other, setOther] = createSignal(1);
    const dataFetch = deferredFetcher((t: number) => t * 10);
    const otherFetch = deferredFetcher((t: number) => t * 100);
    const log: string[] = [];

    let data!: SourceAccessor<number>;
    let setData!: (v: number) => void;
    createRoot(() => {
      [data, setData] = createOptimistic(() => dataFetch.fetch(id()));
      const mOther = createMemo(() => otherFetch.fetch(other()));
      const joined = createMemo(() => `${data()}|${mOther()}`);
      createRenderEffect(joined, v => {
        log.push(v);
      });
    });
    flush();
    dataFetch.resolveAll();
    otherFetch.resolveAll();
    await settle();
    log.length = 0;

    // Entangled refetches + user override.
    setId(2);
    setOther(2);
    setData(99);
    flush();
    expect(data()).toBe(99); // override active while own fetch is in flight (A17)

    // Own source resolves: the fresh value wins NOW — the override must not be
    // held hostage by the still-pending unrelated fetch in the merged transition.
    dataFetch.resolveAll();
    await settle();
    expect(data()).toBe(20);

    otherFetch.resolveAll();
    await settle();
    expect(data()).toBe(20);
    expect(log[log.length - 1]).toBe("20|200");
  });

  // In the simple (unentangled) graph, own-source resolution and transition
  // completion coincide — the override is visible from the write until the
  // refetch lands, then corrects to the fresh value (never the pre-write one).
  it("simple graph: override visible until its own refetch lands, then corrects to the fresh value", async () => {
    const [id, setId] = createSignal(1);
    const fetcher = deferredFetcher((t: number) => t * 10);
    const valueLog: number[] = [];

    let data!: SourceAccessor<number>;
    let setData!: (v: number) => void;
    createRoot(() => {
      [data, setData] = createOptimistic(() => fetcher.fetch(id()));
      createRenderEffect(data, v => {
        valueLog.push(v);
      });
    });
    flush();
    fetcher.resolveAll();
    await settle();
    expect(valueLog).toEqual([10]);
    valueLog.length = 0;

    // Refetch + user override written while the fetch is in flight.
    setId(2);
    setData(99);
    flush();
    expect(data()).toBe(99);
    expect(valueLog).toEqual([99]);

    fetcher.resolveAll();
    await settle();
    // Own async source resolved: corrected to the fresh value, not the
    // pre-write value.
    expect(data()).toBe(20);
    expect(valueLog).toEqual([99, 20]);
  });
});

describe("A19 (was C1): isPending(x) = the observable value of x is not final", () => {
  // Ruling (2026-07-07): three causes of non-finality — (i) write held by a
  // transition (ends at commit), (ii) own async in flight (ends at
  // resolution), (iii) fresh value held uncommitted by an entangled
  // transition (ends at that commit). Pending while any cause holds, final
  // the moment none does. Uninitialized async is loading, not pending —
  // the initial NotReady plays to boundaries (SSR/hydration), see A16.
  // These tests pin the cause-(i) half and the boundary interplay. Causes
  // (ii)/(iii) — verdicts that must survive the transition's death — were
  // implemented by the #2838 redesign and are pinned in the "V1–V4" describe
  // at the bottom of this file.

  it("cause (i): a held trigger write is pending until commit, final at commit", async () => {
    const [tick, setTick] = createSignal(1);
    const fetcher = deferredFetcher((t: number) => t * 10);

    let data!: SourceAccessor<number>;
    createRoot(() => {
      data = createMemo(() => fetcher.fetch(tick()));
      createRenderEffect(data, () => {});
    });
    flush();
    fetcher.resolveAll();
    await settle();
    expect(isPending(tick)).toBe(false);

    setTick(2);
    flush();
    // The write is held: the observable tick() is still 1 — not final.
    expect(tick()).toBe(1);
    expect(isPending(tick)).toBe(true);
    expect(isPending(data)).toBe(true); // its refetch is in flight too

    fetcher.resolveAll();
    await settle();
    // Commit: everything observable is final.
    expect(tick()).toBe(2);
    expect(isPending(tick)).toBe(false);
    expect(isPending(data)).toBe(false);
  });

  it("initialized refetch under a nested loading boundary: content holds, verdicts stay pending until resolution", async () => {
    const [tick, setTick] = createSignal(1);
    const fetcher = deferredFetcher((t: number) => t * 10);
    let rendered: unknown;

    let data!: SourceAccessor<number>;
    createRoot(() => {
      data = createMemo(() => fetcher.fetch(tick()));
      const boundary = createLoadingBoundary(
        () => `v:${data()}`,
        () => "loading"
      );
      createRenderEffect(
        () => (rendered = boundary()),
        () => {}
      );
    });
    flush();
    fetcher.resolveAll();
    await settle();
    expect(rendered).toBe("v:10");

    setTick(2);
    flush();
    // Initialized refetch: no fallback — the boundary holds the old content
    // (fallbacks are for initial loads), and both verdicts report non-final.
    expect(rendered).toBe("v:10");
    expect(isPending(tick)).toBe(true);
    expect(isPending(data)).toBe(true);

    fetcher.resolveAll();
    await settle();
    expect(rendered).toBe("v:20");
    expect(isPending(tick)).toBe(false);
    expect(isPending(data)).toBe(false);
  });

  it("nav revealing an uninitialized async: trigger pending until the new view can show, data is loading (not pending)", async () => {
    const [location, setLocation] = createSignal(1);
    const fetcher = deferredFetcher((t: number) => t * 10);
    let rendered: unknown;

    // page2's data is only read once we navigate — uninitialized until then.
    createRoot(() => {
      const page2Data = createMemo(() => fetcher.fetch(location()));
      const boundary = createLoadingBoundary(
        () => (location() === 2 ? `page2:${page2Data()}` : "page1"),
        () => "fallback"
      );
      createRenderEffect(
        () => (rendered = boundary()),
        () => {}
      );
    });
    flush();
    expect(rendered).toBe("page1");

    setLocation(2);
    flush();
    // The nav can't land yet (page2's data is uninitialized): old view holds,
    // the trigger's observable value is not final.
    expect(rendered).toBe("page1");
    expect(location()).toBe(1);
    expect(isPending(location)).toBe(true);

    fetcher.resolveAll();
    await settle();
    // The new view can show its landed value: nothing is pending anymore.
    expect(rendered).toBe("page2:20");
    expect(location()).toBe(2);
    expect(isPending(location)).toBe(false);
  });
});

describe("A20 (re-ruled 2026-07-13): optimistic writes are verdict-inert — no mask, no announcement", () => {
  // Question-scoped pending model (supersedes the 2026-07-07c mask ruling —
  // see the question-scoped pending plan and question-scoped-pending.test.ts):
  // a read is pending iff a VALUE CHANGE is in flight for it that has not yet
  // revealed, or it carries a live affects() mark.
  //
  // - An active optimistic override DISPLAYS (A17 unchanged) but neither
  //   announces pending on its own slot nor silences anyone else's. A real
  //   question change upstream keeps the slot pending right through the
  //   override — honest mixed state.
  // - Same-question motion (a confirming refetch of unchanged inputs) is
  //   quiet: not pending, override or no override.
  // - Plain reads watch the committed channel: pending during an in-flight
  //   NEW-question fetch AND while a resolved value is still held by its
  //   transition.
  // - `latest` reads watch the fresh channel: holds never pend it, only an
  //   actually-in-flight new-question fetch does.

  it("optimistic computed: an upstream question change pends the slot while the override displays", async () => {
    const fetcher = deferredFetcher((t: number) => t * 10);
    const [id, setId] = createSignal(1);
    let data!: SourceAccessor<number>;
    let setData!: (v: number) => void;
    createRoot(() => {
      [data, setData] = createOptimistic(() => fetcher.fetch(id()));
      createRenderEffect(data, () => {});
    });
    flush();
    fetcher.resolveAll();
    await settle();
    expect(isPending(data)).toBe(false);

    setId(2);
    setData(999); // prediction for id=2
    flush();
    expect(data()).toBe(999); // A17: the override is the value
    expect(isPending(id)).toBe(true); // plain channel: held write, superseded at commit
    expect(isPending(data)).toBe(true); // id=2's answer is in flight — the write can't silence it
    expect(isPending(() => latest(data))).toBe(true); // the fresh channel awaits the same answer

    fetcher.resolveAll();
    await settle();
    // Own source landed: override cleared (A18), everything final at once.
    expect(data()).toBe(20);
    expect(isPending(id)).toBe(false);
    expect(isPending(data)).toBe(false);
    expect(isPending(() => latest(data))).toBe(false);
  });

  it("optimistic signal in an action: the override never reads pending — the affordance IS the flag", async () => {
    // The flag pattern: `adding()` itself is the affordance you render.
    // Deriving "action in flight" from isPending(adding) misreads the model —
    // optimistic writes are verdict-inert; read the optimistic value, not a
    // verdict about it.
    const [adding, setAdding] = createOptimistic(false);
    let release!: () => void;
    let run!: () => Promise<void>;
    createRoot(() => {
      createRenderEffect(adding, () => {});
      run = action(function* () {
        setAdding(true);
        yield new Promise<void>(r => (release = r));
      });
    });
    flush();
    expect(isPending(adding)).toBe(false);

    const done = run();
    flush();
    expect(adding()).toBe(true); // override visible (A17) — this is the affordance
    expect(isPending(adding)).toBe(false); // verdict-inert: no change in flight for this slot

    release();
    await done;
    await settle();
    expect(adding()).toBe(false);
    expect(isPending(adding)).toBe(false);
  });

  it("store: an optimistic edit reads settled on the leaves it touched; untouched siblings stay settled too", async () => {
    let release!: () => void;
    let run!: () => Promise<void>;
    let state!: { title: string; author: string };
    let setState!: (fn: (s: { title: string; author: string }) => void) => void;
    createRoot(() => {
      [state, setState] = createOptimisticStore({ title: "t1", author: "a1" });
      createRenderEffect(
        () => `${state.title}|${state.author}`,
        () => {}
      );
      run = action(function* () {
        setState(s => {
          s.title = "t2";
        });
        yield new Promise<void>(r => (release = r));
      });
    });
    flush();

    const done = run();
    flush();
    expect(state.title).toBe("t2");
    // Plain optimistic store: no source can supersede anything (non-derived),
    // and the write is verdict-inert — nothing reads pending.
    expect(isPending(() => state.title)).toBe(false);
    expect(isPending(() => state.author)).toBe(false);

    release();
    await done;
    await settle();
    expect(state.title).toBe("t1"); // reverted (non-derived store: transaction-scoped)
    expect(isPending(() => state.title)).toBe(false);
    expect(isPending(() => state.author)).toBe(false);
  });

  it("no store-wide mask: an optimistic write mid-refetch cannot silence a question change (A21 deleted)", async () => {
    // Re-ruled 2026-07-13 (question-scoped pending): the old A21 pin here
    // asserted the exact "foos bug" — one optimistic write silenced the whole
    // store while an unrelated new question was still in flight. Under the
    // question-scoped model a new question (tick changed) pends every leaf
    // until its answer reveals, and the optimistic write merely displays.
    // Writers who really do know the refetch's scope declare it with
    // affects(); nothing turns pending OFF.
    let resolveFetch!: (v: { title: string; author: string }) => void;
    const [tick, setTick] = createSignal(0);
    let state!: { title: string; author: string };
    let setState!: (fn: (s: { title: string; author: string }) => void) => void;
    createRoot(() => {
      [state, setState] = createOptimisticStore(
        () => {
          tick();
          return new Promise<{ title: string; author: string }>(r => (resolveFetch = r));
        },
        { title: "t0", author: "a0" }
      );
      createRenderEffect(
        () => `${state.title}|${state.author}`,
        () => {}
      );
    });
    flush();
    resolveFetch({ title: "t1", author: "a1" });
    await settle();
    expect(isPending(() => state.title)).toBe(false);

    // Contrast (proves the probes are live): a pure refetch pends every leaf.
    setTick(1);
    flush();
    expect(isPending(() => state.title)).toBe(true);
    expect(isPending(() => state.author)).toBe(true);

    // An optimistic write mid-refetch displays immediately but is
    // verdict-inert: the in-flight question change keeps EVERY leaf pending,
    // written and untouched alike.
    setState(s => {
      s.title = "t-opt";
    });
    flush();
    expect(state.title).toBe("t-opt");
    expect(isPending(() => state.title)).toBe(true);
    expect(isPending(() => state.author)).toBe(true);

    // Fresh data lands: override consumed, answer revealed — settled.
    resolveFetch({ title: "t2", author: "a2" });
    await settle();
    expect(state.title).toBe("t2");
    expect(isPending(() => state.title)).toBe(false);

    // A later real input change pends again (verdicts stayed live).
    setTick(2);
    flush();
    expect(isPending(() => state.title)).toBe(true);
    expect(isPending(() => state.author)).toBe(true);
    resolveFetch({ title: "t3", author: "a3" });
    await settle();
    expect(isPending(() => state.title)).toBe(false);
  });
});

describe("A22: pending is per-node — store-wide is only the firewall's own work (A9/A21)", () => {
  const tick = () => new Promise(r => setTimeout(r, 0));

  it("a plain store written in a transition pends exactly the touched leaves", async () => {
    const [x, setX] = createStore({ count: 0, foo: 0 });
    let resolveDownstream!: () => void;

    const dispose = createRoot(d => {
      const downstream = createMemo(async () => {
        const v = x.count;
        if (v > 0) await new Promise<void>(r => (resolveDownstream = r));
        return v;
      });
      createRenderEffect(
        () => downstream(),
        () => {}
      );
      createRenderEffect(
        () => [x.count, x.foo],
        () => {}
      );
      return d;
    });
    flush();
    await tick();

    // Write (all writes are transitions): downstream async holds the commit.
    setX(s => {
      s.count++;
    });
    flush();
    expect(x.count).toBe(0); // held
    expect(isPending(() => x.count)).toBe(true); // the touched leaf
    expect(isPending(() => x.foo)).toBe(false); // untouched sibling
    expect(isPending(() => x)).toBe(false); // proxy-level read: nothing

    resolveDownstream();
    await tick();
    flush();
    expect(x.count).toBe(1);
    expect(isPending(() => x.count)).toBe(false);
    dispose();
  });

  it("a projection write held by downstream async pends only the written leaf", async () => {
    const [$src, setSrc] = createSignal(1);
    let resolveDownstream!: () => void;
    let proj!: { a: number; b: number };

    const dispose = createRoot(d => {
      proj = createProjection(
        (s: { a: number; b: number }) => {
          s.a = $src() * 10;
        },
        { a: 0, b: 0 }
      );
      const downstream = createMemo(async () => {
        const v = proj.a;
        if (v > 10) await new Promise<void>(r => (resolveDownstream = r));
        return v;
      });
      createRenderEffect(
        () => downstream(),
        () => {}
      );
      createRenderEffect(
        () => [proj.a, proj.b],
        () => {}
      );
      return d;
    });
    flush();
    await tick();

    setSrc(2);
    flush();
    expect(proj.a).toBe(10); // held at the stale committed value
    expect(isPending(() => proj.a)).toBe(true);
    expect(isPending(() => proj.b)).toBe(false);

    resolveDownstream();
    await tick();
    flush();
    expect(proj.a).toBe(20);
    expect(isPending(() => proj.a)).toBe(false);
    dispose();
  });

  it("verdicts never inherit consumers' in-flight state: leaves settle at commit even under a downstream hold", async () => {
    const [$id, setId] = createSignal(1);
    let resolveFetch!: () => void;
    let resolveDownstream!: () => void;
    let gate = false;
    let store!: { data: number; other: number };

    const dispose = createRoot(d => {
      [store] = createStore(
        async (s: { data: number; other: number }) => {
          const id = $id();
          if (gate) await new Promise<void>(r => (resolveFetch = r));
          s.data = id * 10;
        },
        { data: 0, other: 0 }
      );
      const downstream = createMemo(async () => {
        const v = store.data;
        if (v > 10) await new Promise<void>(r => (resolveDownstream = r));
        return v;
      });
      createRenderEffect(
        () => downstream(),
        () => {}
      );
      createRenderEffect(
        () => [store.data, store.other],
        () => {}
      );
      return d;
    });
    flush();
    await tick();
    gate = true;

    // Phase 1 — the firewall's own fetch in flight: store-wide (A9).
    setId(2);
    flush();
    expect(isPending(() => store.data)).toBe(true);
    expect(isPending(() => store.other)).toBe(true);

    // Phase 2 — fetch commits; downstream async still holds the effect-level
    // reveal, but the data-level commit is immediate: leaves show the landed
    // value and read settled (companions probe from their own lane, A14).
    resolveFetch();
    await tick();
    expect(store.data).toBe(20);
    expect(isPending(() => store.data)).toBe(false);
    expect(isPending(() => store.other)).toBe(false);

    resolveDownstream();
    await tick();
    flush();
    expect(isPending(() => store.data)).toBe(false);
    dispose();
  });
});

describe("A23: the isPending probe is reads-only — returns are never inspected", () => {
  const tick = () => new Promise(r => setTimeout(r, 0));

  it("returning the store proxy reads nothing; reads are what report", async () => {
    const [$id, setId] = createSignal(1);
    let store!: { data: number };

    const dispose = createRoot(d => {
      [store] = createStore(
        async (s: { data: number }) => {
          const id = $id();
          await Promise.resolve();
          s.data = id * 10;
        },
        { data: 0 }
      );
      createRenderEffect(
        () => store.data,
        () => {}
      );
      return d;
    });
    flush();
    await tick();

    // Firewall refetch in flight:
    setId(2);
    flush();
    expect(isPending(() => store.data)).toBe(true); // leaf read reports (A9)
    expect(isPending(() => ({ ...store }))).toBe(true); // spread reads report
    expect(isPending(() => store)).toBe(false); // the return value means nothing

    await tick();
    expect(isPending(() => store.data)).toBe(false);
    dispose();
  });
});

/**
 * V1–V4 — the four known violations found while characterizing the
 * blocked-merged-transition window (2026-07-06/07), fixed by the #2838
 * companion/shadow redesign (2026-07-07). Formerly `it.fails` pins in
 * spec-async-open-questions.test.ts; promoted here on the day they flipped.
 *
 * The "blocked-merged window": a node's own fetch resolved, but a shared
 * reader entangles it with another still-pending async source, so nothing
 * commits yet.
 */
describe("V1–V5: verdicts in and after the blocked-merged window (fixed 2026-07-07)", () => {
  // Shared harness: data's async is entangled with a second async source
  // through a shared reader; data's own fetch has resolved, but the merged
  // transition is still blocked on the other fetch.
  async function enterBlockedWindow(kind: "plain" | "optimistic", prime: boolean) {
    const [id, setId] = createSignal(1);
    const [other, setOther] = createSignal(1);
    const dataFetch = deferredFetcher((t: number) => t * 10);
    const otherFetch = deferredFetcher((t: number) => t * 100);

    let data!: SourceAccessor<number>;
    createRoot(() => {
      if (kind === "plain") {
        data = createMemo(() => dataFetch.fetch(id()));
      } else {
        data = createOptimistic(() => dataFetch.fetch(id()))[0];
      }
      const mOther = createMemo(() => otherFetch.fetch(other()));
      const joined = createMemo(() => `${data()}|${mOther()}`);
      createRenderEffect(joined, () => {});
    });
    flush();
    dataFetch.resolveAll();
    otherFetch.resolveAll();
    await settle();
    if (prime) {
      latest(data);
      isPending(data);
    }

    setId(2);
    setOther(2);
    flush();
    dataFetch.resolveAll();
    await settle();
    // In the window now: data's fetch resolved to 20, transition blocked on other.
    return {
      data,
      finish: async () => {
        otherFetch.resolveAll();
        await settle();
      }
    };
  }

  // Control: the plain memo's behavior in the window — the reference point
  // A13 holds the resting optimistic node to.
  it("control (plain memo): stale read, fresh latest, isPending true in the window", async () => {
    const w = await enterBlockedWindow("plain", true);
    expect(w.data()).toBe(10);
    expect(latest(w.data)).toBe(20);
    expect(isPending(w.data)).toBe(true);
    await w.finish();
    expect(w.data()).toBe(20);
    expect(isPending(w.data)).toBe(false);
  });

  // V1 (A13): a resting optimistic node in the window matches the plain-memo
  // control — stale read, isPending TRUE. Fixed by (a) removing the #2799
  // carve-out from computePendingState (a resting node never holds a revert
  // target — revert targets only coexist with an ACTIVE override — so a held
  // value on a resting node is always a refetch/transition hold), and (b)
  // asyncWrite's resting hold syncing companions like every other write.
  it("V1/A13: resting optimistic reports isPending true in the window", async () => {
    const w = await enterBlockedWindow("optimistic", true);
    expect(w.data()).toBe(10);
    expect(latest(w.data)).toBe(20);
    expect(isPending(w.data)).toBe(true);
    await w.finish();
    expect(w.data()).toBe(20);
    expect(isPending(w.data)).toBe(false);
  });

  // V1, unprimed variant: companions created *inside* the window must derive
  // the same verdict as pre-existing ones — verdicts don't depend on when the
  // consumer first probed.
  it("V1/A13: a companion created inside the window derives the same verdict", async () => {
    const w = await enterBlockedWindow("optimistic", false);
    expect(isPending(w.data)).toBe(true);
    await w.finish();
    expect(isPending(w.data)).toBe(false);
  });

  // V2 (A7/A13): latest()'s verdict must not be read-order dependent. An
  // early probe (made while both fetches were in flight) must not freeze the
  // shadow at the stale value for the rest of the window. Fixed by the same
  // resting-hold companion sync: the arriving value is pushed into the
  // shadow instead of waiting for a recompute that never comes.
  it("V2/A7: an early probe does not freeze latest() at the stale value for the window", async () => {
    const w = await enterBlockedWindow("optimistic", true);
    // (enterBlockedWindow probed once in-flight via prime, then the data
    // fetch landed.) latest() now shows the fresh in-flight value:
    expect(latest(w.data)).toBe(20);
    expect(isPending(w.data)).toBe(true);
    await w.finish();
    expect(latest(w.data)).toBe(20);
    expect(isPending(w.data)).toBe(false);
  });

  // V3 (A19): isPending is data-centric — cause (ii) of non-finality (own
  // async in flight) survives the transition's death. In pure-signals graphs
  // (no render-effect reporters) the transition completes on the first flush
  // while the refetch is still in flight; the companion must re-derive from
  // the data's state, not keep a transition-scoped verdict. Fixed by the
  // settlement checkpoint: optimistic reverts re-derive companions from
  // committed state (snapCompanionsToState).
  it("V3/A19: isPending stays true during the post-transition refetch window", async () => {
    const [tick, setTick] = createSignal(1);
    const fetcher = deferredFetcher((t: number) => t * 10);

    let data!: SourceAccessor<number>;
    createRoot(() => {
      data = createMemo(() => fetcher.fetch(tick()));
    });

    isPending(data); // companion exists before the write
    fetcher.resolveAll();
    await settle();
    expect(latest(data)).toBe(10);
    expect(isPending(data)).toBe(false);

    setTick(2);
    flush();
    // Transition already completed (no reporters), refetch in flight, the
    // observable value is the stale 10 — not final, so pending is true.
    expect(latest(data)).toBe(10);
    expect(isPending(data)).toBe(true);

    fetcher.resolveAll();
    await settle();
    expect(latest(data)).toBe(20);
    expect(isPending(data)).toBe(false);
  });

  // V4 — RE-RULED 2026-07-07c: the latest-form filter is GONE. `latest`
  // strips holds (a held value is its self-applied override — mask), never
  // in-flight async: a leaf downstream of an in-flight firewall refetch is
  // pending in BOTH forms ("true only if downstream of in-progress async"
  // includes the refetch). The row-scoped quiet that the old filter provided
  // is served by co-written data flags, not by verdict forms. What survives
  // of V4 is the stuck-companion fix: once the refresh settles, both
  // verdicts clear (the firewall's status change pokes probed leaf
  // companions).
  it("V4/A20: both forms report a pure firewall refresh on a resting leaf, and both clear at settle", async () => {
    let resolveFetch!: (n: number) => void;
    const [tick, setTick] = createSignal(0);
    let state!: { title: string };
    createRoot(() => {
      [state] = createOptimisticStore(
        async (s: { title: string }) => {
          tick();
          const n = await new Promise<number>(r => (resolveFetch = r));
          s.title = "server" + n;
        },
        { title: "init" }
      );
      createRenderEffect(
        () => state.title,
        () => {}
      );
    });
    flush();
    resolveFetch(1);
    await settle();
    expect(state.title).toBe("server1");

    // Pure refresh: no optimistic edit anywhere, the fetch is in flight —
    // both channels are superseded by it, so both forms report it.
    setTick(1);
    flush();
    expect(isPending(() => state.title)).toBe(true);
    expect(isPending(() => latest(() => state.title))).toBe(true);

    resolveFetch(2);
    await settle();
    expect(state.title).toBe("server2");
    expect(isPending(() => state.title)).toBe(false);
    expect(isPending(() => latest(() => state.title))).toBe(false);
  });

  // V5 (A17/A18 corollary — found and fixed with the revert-target
  // elimination, 2026-07-07b): an authoritative refetch value held in the
  // blocked-merged window must survive a first optimistic write. The old
  // model stashed a revert target on first override (`_pendingValue =
  // _value`), clobbering the held refetch result; the override's revert then
  // resurrected the STALE committed value. With no revert targets, the held
  // value stays a pending commit and elevates at its own transition's commit
  // — unobservably under the override (A17) — so the revert reveals the
  // refetch result.
  it("V5/A17: optimistic write in the blocked window does not clobber the held refetch value", async () => {
    const [id, setId] = createSignal(1);
    const [other, setOther] = createSignal(1);
    const dataFetch = deferredFetcher((t: number) => t * 10);
    const otherFetch = deferredFetcher((t: number) => t * 100);

    let data!: SourceAccessor<number>;
    let setData!: (v: number) => void;
    let release!: () => void;
    let run!: () => Promise<void>;
    createRoot(() => {
      [data, setData] = createOptimistic(() => dataFetch.fetch(id()));
      const mOther = createMemo(() => otherFetch.fetch(other()));
      const joined = createMemo(() => `${data()}|${mOther()}`);
      createRenderEffect(joined, () => {});
      run = action(function* () {
        setData(999);
        yield new Promise<void>(r => (release = r));
      });
    });
    flush();
    dataFetch.resolveAll();
    otherFetch.resolveAll();
    await settle();
    expect(data()).toBe(10);

    // Enter the blocked window: data's fetch lands (20, held), other pending.
    setId(2);
    setOther(2);
    flush();
    dataFetch.resolveAll();
    await settle();
    expect(latest(data)).toBe(20);

    // Optimistic write while the window holds 20.
    const done = run();
    flush();
    expect(data()).toBe(999); // override visible (A17)

    // Everything settles: other fetch lands, action releases, override reverts.
    otherFetch.resolveAll();
    await settle();
    release();
    await done;
    await settle();

    // The refetch produced 20 for id=2; the revert must reveal it, not 10.
    expect(data()).toBe(20);
    expect(latest(data)).toBe(20);
    expect(isPending(data)).toBe(false);
  });
});
