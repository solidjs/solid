/**
 * Visibility oracle — STORE side. The same node states as
 * visibility-oracle.test.ts, entered through store leaves (plain store,
 * optimistic store, derived store / projection), read by the same nine
 * reader kinds through the store's own read sites (`serveDataKey` for
 * tracked reads, `nodeValue` for untracked ones, `optimisticView` for
 * composed views). Store rules that differ from the signal side by ruling:
 * A25 (a derived store's seed is a draft), A9/A22 (the firewall's verdict),
 * A18's store corollary (#2899) and #3434's store carve-out (optimistic store
 * edits keep settle-then-revert; no tracked/displayed split).
 */
import {
  action,
  createMemo,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush
} from "../src/index.js";
import {
  HELD,
  NOT_READY,
  holds,
  never,
  observed,
  rule,
  runOracle,
  settle,
  violation,
  type State
} from "./visibility-oracle.harness.js";

type N = { n: number };

const STATES: State[] = [
  {
    name: "plain store: committed",
    build(installStale) {
      const [s] = createStore<N>({ n: 0 });
      const x = () => s.n;
      installStale(x);
      return { x, dispose() {} };
    },
    expect: {
      untracked: rule(0, "baseline"),
      derivesFrom: rule(0, "baseline"),
      published: rule(0, "baseline"),
      preexisting: rule(HELD, "baseline"),
      staleForeign: rule(0, "baseline"),
      childrenForbidden: rule(0, "baseline"),
      latest: rule(0, "baseline"),
      isPending: rule(false, "baseline"),
      authoritative: rule(0, "baseline")
    }
  },
  {
    name: "plain store: staged, ambient (setStore before the flush)",
    build(installStale) {
      const [s, set] = createStore<N>({ n: 0 });
      const x = () => s.n;
      installStale(x);
      set(d => {
        d.n = 1;
      });
      return { x, dispose() {} };
    },
    expect: {
      untracked: rule(
        0,
        "A28: an untracked store read serves the committed backing until the flush"
      ),
      derivesFrom: rule(1, "the flush carries the write"),
      published: rule(1, "the flush carries the write"),
      preexisting: rule(HELD, "A28: nothing is visible before the flush"),
      staleForeign: rule(1, "the flush carries the write"),
      childrenForbidden: rule(1, "the flush carries the write"),
      latest: rule(0, "A28: latest() reads the flushed staged world"),
      isPending: rule(false, "A28 (2): false for an unflushed write"),
      authoritative: rule(1, "A28 (4): the predicate runs in the carrying flush and sees the write")
    }
  },
  {
    name: "plain store: held by a live action (setStore inside action, yield forever)",
    build(installStale) {
      const [s, set] = createStore<N>({ n: 0 });
      const x = () => s.n;
      installStale(x);
      action(function* () {
        set(d => {
          d.n = 1;
        });
        yield never();
      })();
      flush();
      return { x, dispose() {} };
    },
    expect: {
      untracked: rule(0, "A19 (i) / CS-R33: the committed backing while the write is held"),
      derivesFrom: rule(
        1,
        "A29: a tracked pass served the staged leaf derives from the transaction's world"
      ),
      published: rule(HELD, "A29 (born held)"),
      preexisting: rule(HELD, "A19 (i)"),
      staleForeign: rule(0, "A15 / A26: a stale reader of a parallel transaction shows committed"),
      childrenForbidden: rule(0, "A32"),
      latest: rule(1, "A11 / nodeValue: latest() sees the in-flight parked value (#3075)"),
      isPending: rule(true, "A19 (i) / CS-R33: a write held by an action pends that property"),
      authoritative: rule(1, "A17 carve-out: staged values are authoritative")
    }
  },
  {
    name: "optimistic store: override active (edit inside a live action)",
    build(installStale) {
      const [s, set] = createOptimisticStore<N>({ n: 0 });
      const x = () => s.n;
      installStale(x);
      action(function* () {
        set(d => {
          d.n = 5;
        });
        yield never();
      })();
      flush();
      return { x, dispose() {} };
    },
    expect: {
      untracked: rule(5, "A17 / OS: the override is the displayed value"),
      derivesFrom: rule(5, "A17"),
      published: observed(
        5,
        "as on the signal side: whether a fresh mainline memo publishes or holds is not stated"
      ),
      preexisting: rule(5, "A17: no downstream async, nothing to wait for"),
      staleForeign: rule(5, "A17"),
      childrenForbidden: rule(5, "A32: the override is the frame"),
      latest: rule(5, "A17 / OL-R11"),
      isPending: rule(false, "A24 (3) / OS-R37: optimistic writes are verdict-inert"),
      authoritative: rule(0, "A17 carve-out / authoritativeServe(): never the caller's optimism")
    }
  },
  {
    name: "optimistic store: override, ambient (edit outside any action, before the flush)",
    build(installStale) {
      const [s, set] = createOptimisticStore<N>({ n: 0 });
      const x = () => s.n;
      installStale(x);
      set(d => {
        d.n = 5;
      });
      return { x, dispose() {} };
    },
    expect: {
      untracked: rule(
        0,
        "A28 (5): an optimistic store edit is a write — visible at the flush that carries it (supersedes OS-R1, CS-R34 visibility)"
      ),
      derivesFrom: rule(0, "OL-R5: an ambient optimistic write reverts at the next flush"),
      published: rule(0, "OL-R5"),
      preexisting: rule(HELD, "A28: nothing is visible before the flush"),
      staleForeign: rule(0, "OL-R5"),
      childrenForbidden: rule(0, "OL-R5"),
      latest: rule(0, "A28 (5)"),
      isPending: rule(false, "A24 (3)"),
      authoritative: rule(0, "A17 carve-out")
    }
  },
  {
    name: "derived optimistic store: own truth landed 2 ≠ override 3, action live (A18 through store nodes)",
    async build(installStale) {
      const [value, setValue] = createSignal(0);
      const fetches: Array<() => void> = [];
      const flights: Array<() => void> = [];
      let s!: N;
      let set!: (fn: (d: N) => void) => void;
      const dispose = createRoot(d => {
        [s, set] = createOptimisticStore<N>(
          () => {
            const v = value();
            return new Promise<N>(r => fetches.push(() => r({ n: v * 2 })));
          },
          { n: -1 }
        );
        const downstream = createMemo(() => {
          const n = s.n;
          return new Promise<string>(r => flights.push(() => r(`${n}!`)));
        });
        createRenderEffect(downstream, () => {});
        return d;
      });
      holds.push(() => flights.splice(0).forEach(f => f()));
      flush();
      fetches.shift()!(); // initial truth {n: 0}
      await settle();
      flights.shift()!();
      await settle();
      const x = () => s.n;
      installStale(x);
      action(function* () {
        setValue(1);
        set(d => {
          d.n = 3;
        });
        yield never();
      })();
      flush();
      fetches.shift()!(); // own truth lands {n: 2} ≠ 3
      await settle();
      return { x, dispose };
    },
    expect: {
      untracked: rule(3, "A18 (c): the overlay stays displayed until settle"),
      derivesFrom: rule(
        2,
        "A18 (b) through a store node: the tracked pass derives from the landed truth. (#3434's store carve-out is about the body-end SETTLE order, not landing supersession.)"
      ),
      published: rule(
        HELD,
        "A18 (c) / A29 (born held): the fresh derivation is held with the transaction; the frame keeps the overlay"
      ),
      preexisting: rule(HELD, "A18 (c): the frame keeps the overlay until settle"),
      staleForeign: rule(3, "A18 (c): a stale reader displays the overlay"),
      childrenForbidden: rule(3, "A32"),
      latest: rule(2, "A18 (d) / #3075: latest() sees the landed truth beneath the overlay"),
      isPending: rule(true, "A18 (d) / OS-R39: the landing differs from the override"),
      authoritative: rule(2, "A17 carve-out / authoritativeServe(): the base layer")
    }
  },
  {
    name: "derived store (projection): pending refetch on a new question, flight up",
    async build(installStale) {
      const [q, setQ] = createSignal(0);
      const fetches: Array<() => void> = [];
      let s!: N;
      const dispose = createRoot(d => {
        [s] = createStore<N>(
          () => {
            const v = q();
            return new Promise<N>(r => fetches.push(() => r({ n: v * 10 })));
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
      fetches.shift()!(); // {n: 0}
      await settle();
      const x = () => s.n;
      installStale(x);
      setQ(1); // new question; the flight never lands
      flush();
      return { x, dispose };
    },
    expect: {
      untracked: rule(
        0,
        "A19 (ii) / OS-R32: untracked reads flow the committed value during a refetch window"
      ),
      derivesFrom: rule(
        NOT_READY,
        "A15 / A9: a tracked reader of a firewall-backed leaf whose firewall is refetching suspends"
      ),
      published: rule(HELD, "A15"),
      preexisting: rule(HELD, "A15: the reader observing the flight holds"),
      staleForeign: observed(
        0,
        "as on the signal side: the stale reader re-run by an unrelated write shows the pre-flight committed value — same open question (INPUTS_PUBLISHED for a flight opened by the same batch)"
      ),
      childrenForbidden: rule(0, "A32"),
      latest: rule(
        0,
        "A8 / A9: latest shows the stale value while the firewall's new-question refetch is in flight"
      ),
      isPending: rule(
        true,
        "A9: a store leaf behind a firewall reports the firewall's new-question refetch"
      ),
      authoritative: observed(NOT_READY, "A17 carve-out: nothing landed for the new question")
    }
  },
  {
    name: "derived store (projection): uninitialized — the seed is a draft, never a value (A25)",
    build(installStale) {
      let s!: N;
      const dispose = createRoot(d => {
        [s] = createStore<N>(() => never() as unknown as Promise<N>, { n: -1 });
        createRenderEffect(
          () => s.n,
          () => {}
        );
        return d;
      });
      const x = () => s.n;
      installStale(x);
      flush();
      return { x, dispose };
    },
    expect: {
      untracked: rule(
        NOT_READY,
        "A25: to every outside consumer the store is uninitialized until the first resolution lands — the seed is never visible"
      ),
      derivesFrom: rule(NOT_READY, "A25 / A16 carve-out"),
      published: rule(HELD, "A25"),
      preexisting: rule(HELD, "A25"),
      staleForeign: rule(HELD, "A25 / A15: nothing committed to show"),
      childrenForbidden: rule(NOT_READY, "A32: no frame yet"),
      latest: rule(
        NOT_READY,
        "A7 (amended): latest() of an uninitialized source throws in every scope"
      ),
      isPending: rule(false, "A16 / A19 exception (1): loading, not pending"),
      authoritative: rule(NOT_READY, "A17 carve-out: nothing landed")
    }
  }
];

runOracle("visibility oracle — stores (A9, A17, A18, A19, A25, A29, A32, CS/OS rules)", STATES);
