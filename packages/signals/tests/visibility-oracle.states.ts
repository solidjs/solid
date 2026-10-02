/**
 * Visibility oracle — node state × reader kind → what is served. (States;
 * the runner is visibility-oracle.test.ts, the posture matrix is
 * visibility-oracle-posture.test.ts.)
 *
 * The runtime decides what a read serves at eleven sites (read, readNodeFast,
 * supersededRead, latestRead, gatedRead, laneReadsCommitted, heldFromStale,
 * store nodeValue/serveDataKey/optimisticView). Every new visibility rule is
 * threaded through them by hand. This file pins the OBSERVABLE outcome per
 * cell so a rule that reaches one site and misses another shows up as a red
 * cell instead of an audit finding.
 *
 * Rows: node states. Columns: reader kinds. Each expected cell cites the rule
 * that fixes it (SPEC-ASYNC-SEMANTICS.md). Cells the spec does not fix are
 * `observed(...)`: pinned as current behavior, listed by `reportUnspecified`
 * so they can be brought to a ruling — changing one is a design decision.
 *
 * Reader kinds:
 * - untracked          x() with no observer
 * - derivesFrom        the value a mainline memo's PASS read (compute-side log)
 * - published          what a render effect over that memo published; HELD if nothing
 * - preexisting        what a render effect built before the state published after it (HELD if nothing)
 * - staleForeign       that same effect re-run by an unrelated mainline write
 * - childrenForbidden  createTrackedEffect reading x
 * - latest             latest(() => x())
 * - isPending          isPending(() => x())
 * - authoritative      until()'s predicate reading x (CONFIG_AUTHORITATIVE_READ)
 */
import {
  action,
  createMemo,
  createOptimistic,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  until
} from "../src/index.js";
import {
  HELD,
  holds,
  NOT_READY,
  never,
  observed,
  rule,
  runOracle,
  settle,
  violation,
  type State
} from "./visibility-oracle.harness.js";

/** The #3331 reporter graph: an optimistic computed over an async fetch of a
 * signal, with an async memo downstream. `prime()` lands the initial fetch
 * (and, when `initDownstream`, the downstream's first flight); `supersede()`
 * runs an action that changes the question and guesses wrong, then lands the
 * refetch with the differing truth while the action stays live. */
export function supersededGraph(initDownstream: boolean) {
  const [value, setValue] = createSignal(0);
  const fetchResolvers: Array<() => void> = [];
  const flights: Array<() => void> = [];
  let x!: () => unknown;
  let setDouble!: (v: number) => void;
  const dispose = createRoot(d => {
    [x, setDouble] = createOptimistic(() => {
      const v = value();
      return new Promise<number>(r => fetchResolvers.push(() => r(v * 2)));
    });
    const downstream = createMemo(() => {
      const n = x();
      return new Promise<string>(r => flights.push(() => r(`${n}!`)));
    });
    createRenderEffect(downstream, () => {});
    return d;
  });
  holds.push(() => flights.splice(0).forEach(f => f()));
  return {
    x,
    dispose,
    setValue,
    landFetch: () => fetchResolvers.shift()!(),
    async prime() {
      flush();
      fetchResolvers.shift()!();
      await settle();
      if (initDownstream) {
        flights.shift()!();
        await settle();
      }
    },
    async supersede() {
      const run = action(function* () {
        setValue(1); // new question → refetch
        setDouble(3); // wrong guess; truth will be 2
        yield never();
      });
      run();
      flush();
      fetchResolvers.shift()!(); // own source lands 2 ≠ 3 while the action is live
      await settle();
    }
  };
}

// ── states ──────────────────────────────────────────────────────────────────
export const STATES: State[] = [
  {
    name: "committed (signal, no write)",
    build(installStale) {
      const [x] = createSignal(0);
      installStale(x);
      return { x, dispose() {} };
    },
    expect: {
      untracked: rule(0, "baseline"),
      derivesFrom: rule(0, "baseline"),
      published: rule(0, "baseline"),
      preexisting: rule(HELD, "baseline: nothing new to publish"),
      staleForeign: rule(0, "baseline"),
      childrenForbidden: rule(0, "baseline"),
      latest: rule(0, "baseline"),
      isPending: rule(false, "baseline"),
      authoritative: rule(0, "baseline")
    }
  },
  {
    name: "staged, ambient (set(1) before the flush)",
    build(installStale) {
      const [x, set] = createSignal(0);
      installStale(x);
      set(1);
      return { x, dispose() {} };
    },
    expect: {
      // Readers that flush observe the write land — trivially 1.
      untracked: rule(
        0,
        "A28: an unflushed write is not the committed value — an untracked read serves committed until the flush"
      ),
      derivesFrom: rule(1, "the flush carries the write"),
      published: rule(1, "the flush carries the write"),
      preexisting: rule(HELD, "A28: nothing is visible before the flush"),
      staleForeign: rule(1, "the flush carries the write"),
      childrenForbidden: rule(1, "the flush carries the write"),
      latest: rule(
        0,
        'A28: latest() reads the flushed staged world — the pre-write answer until the flush that carries the write ("nothing is ever 30 while its derivations are still 20-shaped")'
      ),
      isPending: rule(
        false,
        "A28 (2): isPending is false for an unflushed write — nothing is observable yet to be pending from"
      ),
      authoritative: rule(
        1,
        "A28 (4): until()'s predicate is evaluated inside the flush that carries the write, where the write is promoted — it sees 1"
      )
    }
  },
  {
    name: "held by a live action (set(1) inside action, yield forever)",
    build(installStale) {
      const [x, set] = createSignal(0);
      installStale(x);
      const run = action(function* () {
        set(1);
        yield never();
      });
      run(); // imperative scope: the test body
      flush();
      return { x, dispose() {} };
    },
    expect: {
      untracked: rule(
        0,
        "A19 (i): the observable value is the committed one while the write is held"
      ),
      derivesFrom: rule(
        1,
        "A29: a tracked pass served the staged value derives from the transaction's world"
      ),
      published: rule(
        HELD,
        "A29 (born held): a memo created mainline during the hold derives from the transaction’s world and is staged into it; the render effect over it is replayed by the commit, publishing nothing before"
      ),
      preexisting: rule(HELD, "A19 (i): the held write is not on screen"),
      staleForeign: rule(
        0,
        "A15 reveal corollary / A26: a stale reader of a parallel transaction shows committed, no entanglement"
      ),
      childrenForbidden: rule(
        0,
        "A32: children-forbidden readers see the frame; a held write is never visible to them"
      ),
      latest: rule(1, "A8/A11: the held value exists from the write; latest serves it"),
      isPending: rule(true, "A19 (i)"),
      authoritative: rule(
        1,
        "A17 carve-out (2026-09-14): until() reads the landed world — the staged value"
      )
    }
  },
  {
    name: "override active (createOptimistic set to 5 inside a live action)",
    build(installStale) {
      let x!: () => unknown;
      let setO!: (v: number) => void;
      const dispose = createRoot(d => {
        [x, setO] = createOptimistic(0);
        return d;
      });
      installStale(x);
      const run = action(function* () {
        setO(5);
        yield never();
      });
      run();
      flush();
      return { x, dispose };
    },
    expect: {
      untracked: rule(5, "A17: the override is the displayed value"),
      derivesFrom: rule(5, "A17: the override is the graph's value until its own source answers"),
      published: observed(
        5,
        "A17: direct read shows optimistic; whether a mainline memo over it publishes or holds is not stated"
      ),
      preexisting: rule(
        5,
        "A17: the override is the displayed value; no downstream async, so the lane has nothing to wait for"
      ),
      staleForeign: rule(5, "A17: the applied frame shows the override"),
      childrenForbidden: rule(5, "A32: the override is the frame; it shows through"),
      latest: rule(5, "A17 / OL-R11: the override is the value on every channel"),
      isPending: rule(false, "A24 (3): optimistic writes are verdict-inert"),
      authoritative: rule(0, "A17: until()'s predicate never sees the caller's own optimism")
    }
  },
  {
    name: "override, ambient (createOptimistic set to 5 outside any action, before the flush)",
    build(installStale) {
      let x!: () => unknown;
      let setO!: (v: number) => void;
      const dispose = createRoot(d => {
        [x, setO] = createOptimistic(0);
        return d;
      });
      installStale(x);
      setO(5);
      return { x, dispose };
    },
    expect: {
      untracked: rule(
        0,
        "A28 (5): an optimistic write is a write — it becomes the active override at the flush that carries it; until then no reader sees it (supersedes OL-R2)"
      ),
      derivesFrom: rule(
        0,
        "OL-R5: an ambient optimistic write reverts at the next flush (the flush the reader forces)"
      ),
      published: rule(0, "OL-R5"),
      preexisting: rule(HELD, "A28: nothing is visible before the flush"),
      staleForeign: rule(0, "OL-R5"),
      childrenForbidden: rule(0, "OL-R5"),
      latest: rule(
        0,
        "A28 (5): not visible before the flush on any channel (supersedes OL-R11 pre-flush)"
      ),
      isPending: rule(false, "A24 (3)"),
      authoritative: rule(
        0,
        "A17 carve-out: never the caller's optimism (and the ambient override reverts at the flush the reader forces)"
      )
    }
  },
  {
    name: "superseded (own source landed 2 ≠ override 3; initialized downstream flight keeps the action live)",
    async build(installStale) {
      const built = supersededGraph(true);
      await built.prime();
      installStale(built.x);
      await built.supersede();
      return built;
    },
    expect: {
      // Lanes (2026-10-01/02): the guess was written in the frame that
      // re-asked its source and re-fetched its derivation, so its lane was
      // blocked and the guess never displayed; "a correction while blocked
      // voids the never-shown guess" (§16). A18 (c)'s "the display keeps the
      // override until the commit" is about a displayed override — there is
      // none here: direct reads see the committed value, the truth is staged
      // under the action, a fresh reader of it is born held.
      untracked: rule(
        0,
        "lanes: the never-shown guess is void at the correction; the truth is staged"
      ),
      derivesFrom: rule(2, "A18 (b): tracked derivations recompute from the arrived value"),
      published: rule(
        HELD,
        "A18 (c) / A29 (born held): a fresh mainline memo over the superseded node derives from the staged truth and is held with the transaction; the frame keeps the override"
      ),
      preexisting: rule(HELD, "A18 (c): the applied frame keeps the override until commit"),
      staleForeign: rule(0, "lanes: a stale reader of a void guess sees the committed value"),
      childrenForbidden: rule(0, "A32 / lanes: the frame — the never-shown guess is void"),
      latest: rule(2, "A18 (d): latest returns the arrived value"),
      isPending: rule(true, "A18 (d): pending iff the arrival differs from the override"),
      authoritative: rule(2, "A17 carve-out: the authoritative reader sees the staged truth")
    }
  },
  {
    name: "superseded before its first commit (the first landing was held by a downstream reveal that never landed)",
    async build(installStale) {
      const built = supersededGraph(false);
      await built.prime();
      installStale(built.x);
      await built.supersede();
      return built;
    },
    expect: {
      // Lanes (2026-10-01/02): the guess was written in the frame that
      // re-asked its source and re-fetched its derivation, so its lane was
      // blocked and the guess never displayed; "a correction while blocked
      // voids the never-shown guess" (§16). A18 (c)'s "the display keeps the
      // override until the commit" is about a displayed override — there is
      // none here: direct reads see the committed value, the truth is staged
      // under the action, a fresh reader of it is born held.
      // Never committed: no value to serve a direct read (A19 exc. 1 —
      // loading, not pending), `latest` tunnels to the staged truth.
      untracked: rule(
        "throws:NotReady",
        "A19 exc. 1 / lanes: never committed and the guess void — nothing to serve"
      ),
      derivesFrom: rule(2, "A18 (b)"),
      published: rule(HELD, "A18 (c) / A29 (born held)"),
      preexisting: observed(
        HELD,
        "this reader (created after the node initialized) holds. A render effect on the node created BEFORE its first landing published the truth (2) at the supersession in a side probe — while untracked reads still served 3 — so the hold here is shape-dependent; follow-up"
      ),
      staleForeign: rule(
        HELD,
        "lanes / A29: a fresh stale reader of a never-committed node enters"
      ),
      childrenForbidden: rule(0, "A32 / lanes: the frame — nothing committed, the guess void"),
      latest: rule(2, "A18 (d)"),
      isPending: rule(
        false,
        "A19 exc. 1: a never-committed node is loading, not pending (the guess that was 'the observable value' under `next` is void)"
      ),
      authoritative: rule(2, "A17 carve-out")
    }
  },
  {
    name: "pending own async (initialized memo refetching on a new question, flight up)",
    async build(installStale) {
      const [q, setQ] = createSignal(0);
      const resolvers: Array<(v: number) => void> = [];
      let x!: () => unknown;
      const dispose = createRoot(d => {
        const m = createMemo(() => {
          const v = q();
          return new Promise<number>(r => resolvers.push(r)).then(() => v * 10);
        });
        x = m;
        createRenderEffect(m, () => {});
        return d;
      });
      flush();
      resolvers.shift()!(0);
      await settle();
      installStale(x);
      setQ(1); // new question; flight never lands
      flush();
      return { x, dispose, source: q }; // q's write (1) is what the flight holds
    },
    expect: {
      untracked: rule(
        0,
        "A19 (ii): the observable value is the committed one while the node's own async is in flight"
      ),
      derivesFrom: rule(
        NOT_READY,
        "A15: a fresh derivation suspends on the observed flight. (With no reader holding on the flight the pass reads the committed value instead and the reveal holds — the frame is identical; observation-driven transactions make the difference inherent, ruled 2026-09-14.)"
      ),
      published: rule(HELD, "A15"),
      preexisting: rule(HELD, "A15: the reader that observed the flight holds"),
      staleForeign: observed(
        0,
        "A15 reveal corollary says a stale reader holds when the flight's inputs are published (#3305); here the new question was a mainline write and the reader shows the pre-flight committed value — does INPUTS_PUBLISHED cover a flight opened by the same batch?"
      ),
      childrenForbidden: rule(0, "A32: a pending node's committed value is the frame"),
      latest: rule(
        0,
        "A8: latest shows the stale value while the own fetch for a new question is in flight"
      ),
      isPending: rule(true, "A19 (ii) / A24 (2): a new question pends"),
      authoritative: rule(
        NOT_READY,
        "A17 carve-out: nothing has landed for the new question; the predicate suspends like any reader"
      )
    }
  },
  {
    name: "uninitialized (memo whose first flight never lands)",
    build(installStale) {
      let x!: () => unknown;
      const dispose = createRoot(d => {
        const m = createMemo(() => never());
        x = m;
        createRenderEffect(m, () => {});
        return d;
      });
      installStale(x);
      flush();
      return { x, dispose };
    },
    expect: {
      untracked: rule(
        NOT_READY,
        "A19 exception (1): loading, not pending — the NotReady propagates"
      ),
      derivesFrom: rule(
        NOT_READY,
        "A16 carve-out (B5a): tracked contexts propagate NotReady to loading boundaries"
      ),
      published: rule(HELD, "A19 exception (1)"),
      preexisting: rule(HELD, "A19 exception (1)"),
      staleForeign: rule(
        HELD,
        "A15 reveal corollary: an uninitialized node has no committed value to show"
      ),
      childrenForbidden: rule(NOT_READY, "A32: no frame to read yet"),
      latest: rule(
        NOT_READY,
        "A7 (amended 2026-09-14): latest() of an uninitialized node throws in every scope, never undefined"
      ),
      isPending: rule(
        false,
        "A16: an unowned isPending never throws; A19 exception (1): loading is not pending"
      ),
      authoritative: rule(NOT_READY, "A17 carve-out: nothing landed")
    }
  },
  {
    name: "loading window (createMemo with loadingValue -1, first flight up)",
    build(installStale) {
      let x!: () => unknown;
      const dispose = createRoot(d => {
        const m = createMemo(() => never(), { loadingValue: -1 });
        x = m;
        createRenderEffect(m, () => {});
        return d;
      });
      installStale(x);
      flush();
      return { x, dispose };
    },
    expect: {
      untracked: rule(-1, "A27: the loading value is commit #0"),
      derivesFrom: rule(-1, "A27: never suspends readers during the first flight"),
      published: rule(-1, "A27"),
      preexisting: rule(HELD, "A27: the loading value was published before the state; nothing new"),
      staleForeign: rule(-1, "A27"),
      childrenForbidden: rule(-1, "A27: loading-class, no suspension"),
      latest: rule(-1, "A27"),
      isPending: rule(false, "A27: verdict-quiet"),
      authoritative: rule(
        -1,
        "A17 carve-out / A27: the loading value is commit #0 — landed by declaration"
      )
    }
  },
  {
    name: "body ended (override's downstream flight still up; nothing authoritative in flight — #3427)",
    async build(installStale) {
      const flights: Array<() => void> = [];
      let x!: () => unknown;
      let setX!: (v: number) => void;
      const dispose = createRoot(d => {
        [x, setX] = createOptimistic(0);
        const downstream = createMemo(() => {
          const n = x();
          return new Promise<string>(r => flights.push(() => r(`${n}!`)));
        });
        createRenderEffect(downstream, () => {});
        return d;
      });
      holds.push(() => flights.splice(0).forEach(f => f()));
      flush();
      flights.shift()!(); // prime downstream(0)
      await settle();
      installStale(x);
      action(function* () {
        setX(1);
        yield Promise.resolve(); // the body ends; the downstream flight for 1 is still up
      })();
      flush();
      await settle();
      await settle();
      return { x, dispose };
    },
    expect: {
      // Lanes (2026-10-01): the guess never showed — its lane was blocked on
      // the downstream flight — and "a correction while blocked voids the
      // never-shown guess": from the body-end supersession on there is no
      // guess for a direct read to serve, only the truth it reverted to.
      // (Was 1 under `next`'s override slot, which outlived the supersession
      // until the commit.)
      untracked: rule(
        0,
        "A18 body-end corollary / lanes: the never-shown guess is void at the correction; a direct read serves the truth"
      ),
      derivesFrom: rule(
        0,
        "A18 body-end corollary: the override is superseded by the truth at hand (committed 0); the graph re-derives from it"
      ),
      published: rule(
        HELD,
        "A18 (c) / A29: a superseded read is a staged read whether the truth is staged or committed — the fresh derivation is the owning transaction's and is held"
      ),
      preexisting: rule(HELD, "A18 (c): display unchanged until commit"),
      staleForeign: rule(
        0,
        "lanes: a stale reader of a void guess sees the truth it reverted to (the guess never showed)"
      ),
      childrenForbidden: rule(
        0,
        "A32 / lanes: the frame — the never-shown guess is void, the truth shows through"
      ),
      latest: rule(0, "A18 (d): latest returns the truth"),
      isPending: rule(
        false,
        "A24 / lanes: the never-shown guess is void and the display is the truth — no value change in flight (was true under `next`'s override slot, which still displayed 1)"
      ),
      authoritative: rule(0, "A17 carve-out: the truth beneath the override")
    }
  },
  {
    name: "un-superseded (a later mainline landing equal to the override — A18)",
    async build(installStale) {
      const built = supersededGraph(true);
      await built.prime();
      installStale(built.x);
      await built.supersede(); // truth 2 ≠ override 3
      built.setValue(1.5); // mainline new question; the refetch lands 3 === override
      flush();
      built.landFetch();
      await settle();
      return built;
    },
    expect: {
      // Lanes: the correction voided the never-shown guess, so there is no
      // override to un-supersede. The later mainline write re-asks a node the
      // action holds (A34: the tick entangles) and its landing (3) is a plain
      // truth staged under the action: committed 0 everywhere a direct read
      // looks, `latest` 3, pending (0 → 3 in flight), a fresh reader held.
      untracked: rule(0, "lanes / A34: a plain landing staged under the action; committed 0"),
      derivesFrom: rule(3, "A18 (b): tracked derivations recompute from the arrived value"),
      published: rule(HELD, "A29: a fresh reader of the staged truth is born held"),
      preexisting: rule(HELD, "A18 (c): the display never changed"),
      staleForeign: rule(0, "A15: a stale reader sees the committed value"),
      childrenForbidden: rule(0, "A32: the frame"),
      latest: rule(3, "A18 (d): the arrived value"),
      isPending: rule(true, "A24: a value change (0 → 3) is in flight"),
      authoritative: rule(3, "A17 carve-out: the staged truth")
    }
  },
  {
    name: "held truth (a foreign primitive's confirming landing stolen by an awaited until(), action still open — #3164)",
    async build(installStale) {
      let landV1!: () => void;
      const v1 = new Promise<void>(r => (landV1 = r));
      let stream!: () => { version: number };
      let setSaving!: (v: boolean) => void;
      const dispose = createRoot(d => {
        [, setSaving] = createOptimistic(false);
        stream = createMemo(async function* () {
          yield { version: 0 };
          await v1;
          yield { version: 1 };
        });
        createRenderEffect(stream, () => {});
        return d;
      });
      flush();
      await settle();
      const x = () => stream().version;
      installStale(x);
      action(function* () {
        setSaving(true);
        yield until(() => stream().version >= 1);
        yield never(); // stays open past the flip: the confirmation is held
      })();
      flush();
      await settle();
      landV1();
      await settle();
      await settle();
      return { x, dispose };
    },
    expect: {
      untracked: rule(
        0,
        "Rule 1 / held truth (#3164): an untracked read keeps the committed frame until the transaction's reveal"
      ),
      derivesFrom: rule(
        1,
        "held truth (#3164, lane-only mask): to a deriving reader the stolen confirming truth is a staged value like any other — the memo derives from it and enters the transaction (A29); only a lane pass is masked"
      ),
      published: rule(
        HELD,
        "A29: the memo that derived from the held truth is held with the transaction — its render effect publishes at the reveal, not before"
      ),
      preexisting: rule(
        HELD,
        "the flush carrying the stolen landing joins the action (flip-entanglement): the pre-existing effect's pass is held with it, nothing re-publishes (was an observed re-run of the committed 0 under `next`)"
      ),
      staleForeign: rule(0, "A17 held truth"),
      childrenForbidden: rule(0, "A32"),
      latest: rule(1, "A17 held truth: latest() sees the staged truth (the deadlock-free tunnel)"),
      isPending: observed(
        true,
        "the stolen landing is a held fresh value (A19 iii); whether held truth pends is not stated in A17's mask rule"
      ),
      authoritative: rule(
        1,
        "A17 carve-out: until()'s predicate sees the staged truth — the tunnel that keeps the hold deadlock-free"
      )
    }
  },
  {
    name: "loading window over a held input (loadingValue memo re-asked by an action-held write; its flight lands while the input is held)",
    async build(installStale) {
      const [q, setQ] = createSignal(0);
      const fetches: Array<() => void> = [];
      let x!: () => unknown;
      const dispose = createRoot(d => {
        const m = createMemo(
          () => {
            const v = q();
            return new Promise<number>(r => fetches.push(() => r(v * 10)));
          },
          { loadingValue: -1 }
        );
        x = m;
        createRenderEffect(m, () => {});
        return d;
      });
      flush();
      installStale(x);
      action(function* () {
        setQ(1); // new question while the window is still open
        yield never();
      })();
      flush();
      fetches.splice(0).pop()!(); // the newest flight lands (10) — held by the action
      await settle();
      return { x, dispose };
    },
    expect: {
      untracked: rule(
        10,
        "A27 (ruled 2026-09-15): the window's first real landing is initial-load class — like a boundary's first content reveal — and commits on arrival even when the input that re-asked it is held by an action"
      ),
      derivesFrom: rule(10, "A27: initial-load class"),
      published: rule(10, "A27: initial-load class"),
      preexisting: rule(10, "A27: the landing reveals on arrival"),
      staleForeign: rule(10, "A27: initial-load class"),
      childrenForbidden: rule(10, "A27: initial-load class"),
      latest: rule(10, "A27: initial-load class"),
      isPending: rule(
        false,
        "A27: verdict-quiet through the window — a hydration invariant (the server answers false; the client must match on creation)"
      ),
      authoritative: rule(10, "A27: initial-load class")
    }
  }
];
