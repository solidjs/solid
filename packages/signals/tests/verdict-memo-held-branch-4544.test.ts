/**
 * #4544 — ruled 2026-10-31; PROBE BRANCH (`probe/4544-probed-held-bit`): the
 * rows below are the RULED screens, and this branch does not reach them.
 * The node-bit encoding (REACTIVE_PROBED_HELD / CONFIG_PROBED_HELD) breaks
 * D-25's "either read order" on the pass where the probed node first goes
 * pending or held with the plain read ahead of the probe (`[h(),
 * isPending(h)]`: the posture a nothing-found probe left is what served the
 * screen there), flipping ~50 pins; and Shape 1 does not flip on its own:
 * once `params` joins T, the `plan` write is held by T (L2), `chrome`'s seam
 * re-derive finds it held and is T's verdict reader, and `params` inherits
 * the posture (#4050) / enters T's verdict lane (#4399). See the branch's
 * commit message for the measurements.
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
 * hold that dirties them (D-25: the probe decides the pass's posture — toward
 * the hold it probed). `isPending(plan)` with `plan` unheld shows nothing
 * ahead of the `session` hold, so `params` is that hold's plain derivation
 * (D-1): on every pass — the held flush and a later unrelated sync write to
 * `plan` — it reads `"acc"`, the branch shows `rows`, the hold lands. Before
 * the fix, `params` carried the verdict posture (through #4050's inheritance
 * in the memo case) and `recompute`'s head refused it the join: its plain
 * read of `session` was served the committed `undefined`, the branch — born
 * into the hold — read `signedOutOnly`, a lazy memo over a never-resolving
 * promise, and the hold waited on it forever.
 *
 * The verdict posture itself (CONFIG_VERDICT: a dependency going pending
 * re-derives the reader instead of marking it) is still stamped at the
 * window, whatever the probe finds — `isPending(x)` before `x`'s first flight
 * must still flip. What the probe's finding decides is the frame-reader half
 * (REACTIVE_PROBED_HELD / CONFIG_PROBED_HELD, set by the probe that finds a
 * held, staged, in-flight or lane's node; inherited through #4050's arm like
 * the posture).
 *
 * Shape 2 below (same-node, `isPending(session)` inside `params`) is RULED AS
 * TODAY (A10): a verdict reader checks the verdict before trusting the value.
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
 * MAINLINE render effect (outside every hold) saw of it. */
function page(probe: Probe, withSecondHold = false) {
  const [session, setSession] = createSignal<string | undefined>(undefined);
  const [plan, setPlan] = createSignal(false);
  const [gate, setGate] = createSignal(0);
  const [gateU, setGateU] = createSignal(0);
  let release: () => void = () => {};
  let releaseU: () => void = () => {};
  let screen = "";
  const branchSaw: Params[] = [];
  const mainlineSaw: Params[] = [];
  let params!: () => Params;
  const dispose = createRoot(dispose => {
    const held = createMemo(() => {
      const g = gate();
      return g === 0 ? g : new Promise<number>(r => (release = () => r(g)));
    });
    // A second hold, on `plan` (the timing edge): a held async memo whose
    // flush also writes `plan`.
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
          const u = withSecondHold ? heldU() : 0;
          let s: unknown = show();
          while (typeof s === "function") s = s();
          return `${h + u} ${s}`;
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
for (const probe of ["plain read", "isPending", "latest", "inline isPending"] as Probe[])
  it(`${probe} of an unrelated signal upstream: the branch the hold opens reads the hold's session and the hold lands`, async () => {
    const r = await arrive(probe);
    expect(r.screen).toBe("1 rows");
    // The branch read the hold's world on every pass: `signedIn` true.
    // (`plan` is `true` through `latest` and the plain reads; in the
    // `isPending` row `chrome`'s plain `plan()` beside its probe is the
    // screen's `false` once the `plan` write is held — A10.)
    expect(r.duringHold.branch).toMatchObject({ signedIn: true });
    // The mainline reader of `params` saw the screen: `params` is held with
    // the write (D-1), so the mainline effect still shows the committed
    // value — `signedIn` false, `plan` committed too (`params`'s later pass
    // over the `plan` write stayed in the hold).
    expect(r.duringHold.mainline).toMatchObject({ plan: false, signedIn: false });
  });

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

// The timing edge. `params` probes `plan` while unheld (no frame posture).
// LATER `plan` is held by a second hold U; `params`, dirtied by U's write,
// re-runs and its probe finds `plan` held: it is U's verdict reader (display
// ahead in U's verdict lane). Then T writes `session` and opens the branch:
// `params` re-runs again, dirtied by T's write, and its probe finds `plan`
// still held by U.
//
// What it is for T on that pass: a frame reader — it is served the committed
// `session` (`undefined`) and re-derives at T's landing — although it probed
// nothing of T's. The ruling's slogan read strictly ("toward the hold it
// probed") would make it T's ordinary derivation; D-25's letter ("posture
// from the node alone") and the mechanism (one bit on the node, not one per
// hold) make it a frame reader toward every hold. The letter is also the
// coherent screen: `params` is shown now as U's verdict lane's work, so a
// plain read of T's staging in it would show T's world ahead of T's landing
// (a lane sees the screen plus its own guesses, D-37). So the branch T opens
// reads `signedIn: false` beside `plan: true` (U's held write, through the
// lane) and holds on `signedOutOnly` — until U lands: `params` re-runs at
// U's landing, its probe finds `plan` unheld, no frame posture, and it joins
// T through its plain read of `session` (D-1); the branch re-runs with
// `signedIn: true`, drops `signedOutOnly`, and T lands on `rows`.
it("timing edge: a probe that finds its node held by U makes the pass U's verdict reader and T's frame reader for that pass; once U lands, the probe finds nothing and the pass is T's plain derivation", async () => {
  const p = page("inline isPending", true);
  try {
    flush();
    expect(p.screen()).toBe("0 signed out");
    // U: holds `plan`.
    p.setGateU(1);
    p.setPlan(true);
    flush();
    expect(p.screen()).toBe("0 signed out");
    // `params` is U's verdict reader: the mainline effect sees its
    // display-ahead pass now — the plain `plan()` beside the probe is the
    // screen's `false` (A10), `signedIn` committed.
    expect(p.mainlineSaw.at(-1)).toMatchObject({ plan: false, signedIn: false });
    // T: holds `session`, opens the branch. `params` re-runs with its probe
    // finding `plan` held by U — a frame reader of T for that pass.
    p.setGate(1);
    p.setSession("acc");
    flush();
    expect(p.branchSaw.at(-1)).toMatchObject({ plan: false, signedIn: false });
    expect(p.screen()).toBe("0 signed out");
    // U lands: `params` re-runs, finds `plan` unheld — T's plain derivation.
    p.releaseU();
    await tick();
    await tick();
    expect(p.branchSaw.at(-1)).toMatchObject({ plan: true, signedIn: true });
    // T lands on `rows`.
    p.release();
    await tick();
    await tick();
    expect(p.screen()).toBe("2 rows");
  } finally {
    p.dispose();
  }
});
