/**
 * #4544. A held update writes `session` and opens a branch that exists only
 * for that write. Inside, `params` reads `session` and `chrome`; `chrome`
 * reads an unrelated signal `plan`.
 *
 * `chrome` computes under the probe in its own body (A31 / D-25): `isPending`
 * then `plan()` is the screen beside the probe. `params`, holding the hold's
 * staging of `session`, is that hold's work. A probe in its own body does not
 * pull that staging out (D-25: the hold's work reads plainly). The probed
 * node still reads as the screen (A10). The branch the hold opened therefore
 * reads `session` as signed in, returns `rows`, and the hold lands — a
 * never-resolving signed-out fetch is not what it waits on.
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

type Probe = "plain read" | "isPending" | "latest" | "inline isPending" | "same-node isPending";
type Params = { plan: boolean; signedIn: boolean; busy?: boolean };

function page(probe: Probe) {
  const [session, setSession] = createSignal<string | undefined>(undefined);
  const [plan, setPlan] = createSignal(false);
  const [gate, setGate] = createSignal(0);
  let release: () => void = () => {};
  let screen = "";
  const branchSaw: Params[] = [];
  const chromeSaw: boolean[] = [];
  let signedOutIssued = false;
  const dispose = createRoot(dispose => {
    const held = createMemo(() => {
      const g = gate();
      return g === 0 ? g : new Promise<number>(r => (release = () => r(g)));
    });
    const out = createLoadingBoundary(
      () => {
        const chrome = createMemo(() => {
          const v =
            probe === "isPending"
              ? (isPending(plan), plan())
              : probe === "latest"
                ? latest(plan)
                : plan();
          chromeSaw.push(v);
          return v;
        });
        const params = createMemo(() =>
          probe === "same-node isPending"
            ? { plan: plan(), signedIn: session() !== undefined, busy: isPending(session) }
            : {
                plan: probe === "inline isPending" ? (isPending(plan), plan()) : chrome(),
                signedIn: session() !== undefined
              }
        );
        const signedOutOnly = createMemo(
          () => {
            signedOutIssued = true;
            return new Promise<never>(() => {});
          },
          { lazy: true }
        );
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
    return dispose;
  });
  return {
    dispose,
    screen: () => screen,
    branchSaw,
    chromeSaw,
    setSession,
    setPlan,
    setGate,
    release: () => release(),
    signedOutIssued: () => signedOutIssued
  };
}

for (const probe of ["plain read", "isPending", "latest"] as Probe[])
  it(`${probe} upstream of a held branch: the branch reads the hold's session and the hold lands`, async () => {
    const p = page(probe);
    try {
      flush();
      expect(p.screen()).toBe("0 signed out");
      p.setGate(1);
      p.setSession("acc");
      flush();
      // The branch the hold opens, before the unrelated write.
      expect(p.branchSaw.at(-1)).toMatchObject({ plan: false, signedIn: true });
      p.setPlan(true);
      flush();
      // `chrome`'s own value follows its probe (D-25: a memo computes under
      // its own posture). `latest` and a plain read see `plan`'s write;
      // `isPending` then `plan()` is the screen beside the probe.
      const chrome = p.chromeSaw.at(-1);
      expect(p.branchSaw.at(-1)).toMatchObject({
        plan: probe === "isPending" ? false : true,
        signedIn: true
      });
      expect(chrome).toBe(probe === "isPending" ? false : true);
      p.release();
      await tick();
      await tick();
      expect(p.screen()).toBe("1 rows");
    } finally {
      p.dispose();
    }
  });

it("inline isPending(plan): the branch reads the hold's session and the hold lands without the signed-out fetch", async () => {
  const p = page("inline isPending");
  try {
    flush();
    expect(p.screen()).toBe("0 signed out");
    p.setGate(1);
    p.setSession("acc");
    flush();
    p.setPlan(true);
    flush();
    // `isPending(plan)` then `plan()` is the screen. `session` is the hold's
    // write, so the branch the hold opened stays signed in and never starts
    // the signed-out fetch.
    expect(p.branchSaw.at(-1)).toMatchObject({ plan: false, signedIn: true });
    expect(p.signedOutIssued()).toBe(false);
    p.release();
    await tick();
    await tick();
    expect(p.screen()).toBe("1 rows");
  } finally {
    p.dispose();
  }
});

it("same-node isPending(session): the branch reads the hold's session and the hold lands", async () => {
  const p = page("same-node isPending");
  try {
    flush();
    p.setGate(1);
    p.setSession("acc");
    flush();
    p.setPlan(true);
    flush();
    // The plain read of `session` is the hold's staging. The branch returns
    // `rows` rather than waiting on the signed-out fetch.
    expect(p.branchSaw.at(-1)).toMatchObject({ signedIn: true, busy: true });
    p.release();
    await tick();
    await tick();
    expect(p.screen()).toBe("1 rows");
  } finally {
    p.dispose();
  }
});
