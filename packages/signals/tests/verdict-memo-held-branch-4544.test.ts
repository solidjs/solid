/**
 * #4544 — ruled 2026-10-31; the seat-per-hold refinement (D-25 as amended
 * 2026-11-01, `documentation/plans/seat-per-hold.md`).
 *
 * A held update writes `session` and opens a branch
 * (`Show when={session() !== undefined}`) that exists only for
 * `session === "acc"`. Inside, the branch reads a pre-existing memo
 * `params = [chrome(), session() !== undefined]`; `chrome` reads an unrelated
 * signal `plan` that no hold holds.
 *
 * The ruling: a probe (`isPending`/`latest`) of a node that is neither held
 * nor pending at the time of the probe earns the probing pass no frame
 * posture — the pass, and memos over it, remain ordinary derivations of any
 * hold that dirties them (D-25: a posture is toward the hold it was earned
 * against, and nothing toward one that holds nothing it asked about).
 * `isPending(plan)` with `plan` unheld shows nothing ahead of the `session`
 * hold, so `params` is that hold's plain derivation (D-1): on every pass —
 * the held flush and a later unrelated sync write to `plan` — it reads
 * `"acc"`, the branch shows `rows`, the hold lands.
 *
 * Shape 2 below (same-node, `isPending(session)` inside `params`) is RULED
 * AS TODAY (A10): a verdict reader checks the verdict before trusting the
 * value.
 *
 * The timing edge is the per-hold seat itself (D-25 L207: "a pass may hold
 * different seats toward different holds"): `params`, U's verdict reader
 * by its probe of U-held `plan`, is T's work when T's write dirties it —
 * `{plan: false, signedIn: true}` in one pass — and T lands without U.
 */
import { expect, it } from "vitest";
import {
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest,
  untrack
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flush();
};
const NEVER = new Promise<never>(() => {});

type Probe = "plain read" | "isPending" | "latest" | "inline isPending" | "same-node isPending";

type Params = { plan: boolean; signedIn: boolean; busy?: boolean };

/** The page: a held async memo under a loading boundary beside a `Show` the
 * `session` write opens; `params` is read inside the branch. Returns what
 * the screen shows, what the branch's reader saw of `params`, and what a
 * MAINLINE render effect (outside every hold) saw of it. `withSecondHold`:
 * a second held async memo, `heldU`, whose flush also writes `plan` — shown
 * by a reader of its own (a reader of both `held` and `heldU` would
 * entangle the two holds into one, A15 / D-4, and there would be no second
 * hold to be seated toward). */
function page(probe: Probe, withSecondHold = false) {
  const [session, setSession] = createSignal<string | undefined>(undefined);
  const [plan, setPlan] = createSignal(false);
  const [gate, setGate] = createSignal(0);
  const [gateU, setGateU] = createSignal(0);
  let release: () => void = () => {};
  let releaseU: () => void = () => {};
  let screen = "";
  let screenU = "";
  const branchSaw: Params[] = [];
  const mainlineSaw: Params[] = [];
  let params!: () => Params;
  const dispose = createRoot(dispose => {
    const held = createMemo(() => {
      const g = gate();
      return g === 0 ? g : new Promise<number>(r => (release = () => r(g)));
    });
    const heldU = createMemo(() => {
      const g = gateU();
      return g === 0 ? g : new Promise<number>(r => (releaseU = () => r(g)));
    });
    const out = createLoadingBoundary(
      () => {
        // The only difference between the rows is how `plan` is read.
        const chrome = createMemo(() =>
          probe === "isPending"
            ? (isPending(plan), plan())
            : probe === "latest"
              ? latest(plan)
              : plan()
        );
        params = createMemo(() =>
          probe === "same-node isPending"
            ? { plan: plan(), signedIn: session() !== undefined, busy: isPending(session) }
            : {
                plan: probe === "inline isPending" ? (isPending(plan), plan()) : chrome(),
                signedIn: session() !== undefined
              }
        );
        const signedOutOnly = createMemo(() => NEVER, { lazy: true });
        // <Show when={session() !== undefined} fallback="signed out">
        //   <b>{params().signedIn ? "rows" : signedOutOnly()}</b>
        // </Show>
        const cond = createMemo(() => session() !== undefined);
        const show = createMemo(() => {
          if (!cond()) return "signed out";
          return untrack(() => {
            let text = "";
            createRenderEffect(
              () => {
                const p = params();
                branchSaw.push(p);
                return p.signedIn ? "rows" : signedOutOnly();
              },
              v => {
                text = v as string;
              }
            );
            return () => text;
          });
        });
        return createMemo(() => {
          const h = held();
          let s: unknown = show();
          while (typeof s === "function") s = s();
          return `${h} ${s}`;
        });
      },
      () => "root"
    );
    createRenderEffect(
      () => {
        let v: unknown = out;
        while (typeof v === "function") v = v();
        return v;
      },
      v => {
        screen = v as string;
      }
    );
    if (withSecondHold)
      createRenderEffect(
        () => heldU(),
        u => void (screenU = String(u))
      );
    // Shape 3's control: a mainline render effect over `params`, created
    // outside every hold, reads it the whole time.
    createRenderEffect(
      () => params(),
      p => void mainlineSaw.push(p)
    );
    return dispose;
  });
  return {
    dispose,
    screen: () => screen,
    screenU: () => screenU,
    branchSaw,
    mainlineSaw,
    setSession,
    setPlan,
    setGate,
    setGateU,
    release: () => release(),
    releaseU: () => releaseU()
  };
}

async function arrive(probe: Probe) {
  const p = page(probe);
  try {
    flush();
    expect(p.screen()).toBe("0 signed out");
    p.setGate(1);
    p.setSession("acc");
    flush();
    p.setPlan(true);
    flush();
    const duringHold = {
      branch: p.branchSaw.at(-1),
      mainline: p.mainlineSaw.at(-1)
    };
    p.release();
    await tick();
    await tick();
    return { screen: p.screen(), duringHold };
  } finally {
    p.dispose();
  }
}

// Shape 1 (the reporter's): a probe of the unrelated, unheld `plan` — in a
// memo upstream, or inline — leaves `params` the hold's plain derivation.
//
// The plain row passes. The three probe rows are pinned at the ruled screen
// and FAIL today (`it.fails`), on the `plan` write's flush, by the rules as
// amended — a conflict the maintainer must rule on, not a mechanism gap:
// the `plan` write reaches `params`'s T staging and joins T (L2); `chrome`'s
// probe of the staging is D-22's provisional verdict and re-derives at the
// seam as T's verdict reader (`plan()` the screen's `false`, A10 — the
// comment below); `params`, dirtied by that re-derive, inherits the posture
// (#4050) while holding a T staging, and D-25's "a node holding a mere T
// staging … is T's verdict reader: the probe wins" (ruled 2026-11-01;
// `latest-first-one-pass-4402` pins it for inherited postures too) serves
// it the committed `session` — the branch reads `signedIn: false`, asks
// `signedOutOnly`, and T waits on it: `0 signed out`. Row 1 of the first
// flush is right (`signedIn: true`, T's work), as is the seat decided at the
// pass head (the join does not turn the pass into T's verdict reader
// halfway, core.ts `recompute`); the conflict is between the ruling above
// and D-25 as amended on the seam's re-pass.
for (const probe of ["plain read", "isPending", "latest", "inline isPending"] as Probe[])
  (probe === "plain read" ? it : it.fails)(
    `${probe} of an unrelated signal upstream: the branch the hold opens reads the hold's session and the hold lands`,
    async () => {
      const r = await arrive(probe);
      expect(r.screen).toBe("1 rows");
      // The branch read the hold's world on every pass: `signedIn` true.
      // (`plan` is `true` through `latest` and the plain reads; in the
      // `isPending` row `chrome`'s plain `plan()` beside its probe is the
      // screen's `false` once the `plan` write is held — a pass dirtied by
      // T's flush that also probes T is T's verdict reader, D-25 L207 — and
      // `params` over it reads that `false` as T's plain derivation.)
      expect(r.duringHold.branch).toMatchObject(
        probe === "isPending" ? { plan: false, signedIn: true } : { plan: true, signedIn: true }
      );
      // The mainline reader of `params` saw the screen: `params` is held with
      // the write (D-1), so the mainline effect still shows the committed
      // value — `signedIn` false, `plan` committed too (`params`'s later pass
      // over the `plan` write stayed in the hold).
      expect(r.duringHold.mainline).toMatchObject({ plan: false, signedIn: false });
    }
  );

// Shape 2 — RULED AS TODAY (A10: a verdict reader checks the verdict before
// trusting the value). `params` itself probes `session`: it IS the hold's
// verdict reader, so inside the branch it reads `[busy: true, signedIn:
// false (committed)]` like any verdict reader (D-23, D-25). The branch that
// trusts `signedIn` without checking `busy` fetches for the wrong world and
// the hold waits on it (F-2): the screen never leaves the committed frame.
// Ruled 2026-10-31 (#4544, same-node form).
it("same-node isPending(session) inside params: a verdict reader of the hold sees the screen beside the verdict; the branch that trusts the value without the verdict holds the hold (A10, ruled)", async () => {
  const r = await arrive("same-node isPending");
  expect(r.duringHold.branch).toMatchObject({ signedIn: false, busy: true });
  // Shape 3 (control): the mainline render effect over the same `params`
  // sees the same values during the hold — the verdict now, the committed
  // `signedIn`. Unchanged.
  expect(r.duringHold.mainline).toMatchObject({ signedIn: false, busy: true });
  expect(r.screen).toBe("0 signed out");
});

// Shape 4 (control): `isPending(x)` probed while `x` IS held, in a memo read
// mainline — today's verdict-reader behaviour. `probe` is the hold's verdict
// reader, and so is the memo over it (#4050): `[true, undefined]` now, then
// `[false, "acc"]` at the landing. (D-23 / D-25's existing pins cover the
// rest of this ground.)
it("control: a probe that finds its node held makes the pass, and a memo over it, the hold's verdict reader as before", async () => {
  const [session, setSession] = createSignal<string | undefined>(undefined);
  const [gate, setGate] = createSignal(0);
  let release: () => void = () => {};
  const log: string[] = [];
  const dispose = createRoot(dispose => {
    const held = createMemo(() => {
      const g = gate();
      return g === 0 ? g : new Promise<number>(r => (release = () => r(g)));
    });
    const probe = createMemo(() => isPending(session));
    const both = createMemo(() => [probe(), session()] as const);
    createRenderEffect(
      () => `${held()}`,
      () => {}
    );
    createRenderEffect(
      () => both(),
      v => void log.push(`${v[0]},${v[1]}`)
    );
    return dispose;
  });
  try {
    flush();
    expect(log).toEqual(["false,undefined"]);
    setGate(1);
    setSession("acc");
    flush();
    expect(log).toEqual(["false,undefined", "true,undefined"]);
    release();
    await tick();
    await tick();
    expect(log).toEqual(["false,undefined", "true,undefined", "false,acc"]);
  } finally {
    dispose();
  }
});

// The timing edge — the seat is per hold (D-25 L207, amended 2026-11-01: "A
// pass may hold different seats toward different holds (U's verdict reader
// and T's work)"). `params` probes `plan` while unheld (no posture). LATER
// `plan` is held by a second hold U; `params`, dirtied by U's write, re-runs
// and its probe finds `plan` held: it is U's verdict reader (display ahead
// in U's verdict lane). Then T writes `session` and opens the branch:
// `params` re-runs, dirtied by T's write, and its probe finds `plan` still
// held by U — and nothing of T's.
//
// Toward T, that pass is T's work: dirtied by T's flush having probed
// nothing of T (D-2 in-flush), it reads T's `session` staging plainly.
// Toward U it is still U's verdict reader: its `plan()` beside the probe is
// the screen's `false` (A10). One pass, two seats: the branch T opens reads
// `{plan: false, signedIn: true}`, shows `rows`, and T lands on it without
// waiting for U (F-6: a verdict reader never waits for the hold it reads
// ahead of). U lands after: `params` re-runs, its probe finds `plan`
// unheld, and it is a plain derivation again — `{plan: true, signedIn:
// true}`. (The probe branch `probe/4544-probed-held-bit` pinned the
// node-level posture here — "a frame reader toward every hold", `signedIn:
// false` and T waiting on U — the row the refinement overturns.)
it("timing edge: a probe that finds its node held by U makes the pass U's verdict reader; dirtied by T's write with no probe of T it is T's work in the same pass, and T lands before U", async () => {
  const p = page("inline isPending", true);
  try {
    flush();
    expect(p.screen()).toBe("0 signed out");
    expect(p.screenU()).toBe("0");
    // U: holds `plan`.
    p.setGateU(1);
    p.setPlan(true);
    flush();
    expect(p.screen()).toBe("0 signed out");
    // `params` is U's verdict reader: the mainline effect sees its
    // display-ahead pass now — the plain `plan()` beside the probe is the
    // screen's `false` (A10), `signedIn` committed.
    expect(p.mainlineSaw.at(-1)).toMatchObject({ plan: false, signedIn: false });
    // T: holds `session`, opens the branch. `params` re-runs: T's work and
    // U's verdict reader at once.
    p.setGate(1);
    p.setSession("acc");
    flush();
    expect(p.branchSaw.at(-1)).toMatchObject({ plan: false, signedIn: true });
    expect(p.screen()).toBe("0 signed out");
    // T lands first, on `rows`; U is still open, `plan` still held.
    p.release();
    await tick();
    await tick();
    expect(p.screen()).toBe("1 rows");
    expect(p.screenU()).toBe("0");
    expect(p.mainlineSaw.at(-1)).toMatchObject({ plan: false, signedIn: true });
    // U lands: `params` re-runs, finds `plan` unheld — a plain derivation.
    p.releaseU();
    await tick();
    await tick();
    expect(p.screenU()).toBe("1");
    expect(p.branchSaw.at(-1)).toMatchObject({ plan: true, signedIn: true });
    expect(p.mainlineSaw.at(-1)).toMatchObject({ plan: true, signedIn: true });
    expect(p.screen()).toBe("1 rows");
  } finally {
    p.dispose();
  }
});

// The other half of that pass (D-37 as amended 2026-11-01: "a lane node
// dirtied by a parent-side hold T's flush is T's work on that pass — the
// staging it publishes is T's, revealed at T's landing, while the lane keeps
// showing its own value"). `params` is U's verdict lane's node: what U's
// readers — the mainline effect over it, re-run by the lane's re-staging —
// see is the lane's value `{plan: false, signedIn: false}`, and T's
// `signedIn: true` reaches them at T's landing only. Pinned at the ruled
// screen and FAILING today (`it.fails`), on base and here alike: the node
// has one lane slot, and the pass dirtied by T's write stages into it as
// U's lane work (`recompute`'s head seats an override node in its lane;
// `laneStage` keeps a pass that read a lane value), so `signedIn: true` is
// shown through U's lane ahead of T's landing — a held value on screen
// before its hold lands (F-1). The two-slot seat (the lane's value kept,
// T's staging beside it) is the lane-engine half of the per-hold seat
// (seat-per-hold.md "Relationship to #3905"), not built in this PR.
it.fails(
  "timing edge, the lane's side: U's readers of `params` keep seeing the lane's value while T holds its staging (D-37 as amended)",
  async () => {
    const p = page("inline isPending", true);
    try {
      flush();
      p.setGateU(1);
      p.setPlan(true);
      flush();
      expect(p.mainlineSaw.at(-1)).toMatchObject({ plan: false, signedIn: false });
      p.setGate(1);
      p.setSession("acc");
      flush();
      expect(p.branchSaw.at(-1)).toMatchObject({ plan: false, signedIn: true });
      // The lane's value, not T's staging.
      expect(p.mainlineSaw.at(-1)).toMatchObject({ plan: false, signedIn: false });
      p.release();
      await tick();
      await tick();
      expect(p.mainlineSaw.at(-1)).toMatchObject({ plan: false, signedIn: true });
    } finally {
      p.dispose();
    }
  }
);
