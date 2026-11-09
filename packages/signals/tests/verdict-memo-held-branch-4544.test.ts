/**
 * #4544. A held update writes `session` and opens a branch that exists only
 * for that write. Inside, `params` reads `session` and `chrome`; `chrome`
 * reads an unrelated signal `plan`, written afterwards.
 *
 * `chrome` computes under the probe in its own body (A31 / D-25). `params`
 * holds its own staging of the hold (`session`): it is that hold's work, and
 * the verdict posture it inherits by reading `chrome` neither pulls it out
 * nor serves it the hold's committed `session` (D-25, 2026-11-02). The
 * branch reads the hold's session and the hold lands — whether the writes go
 * through one `flush()` or several (F-10).
 *
 * `params` probing in its own body (inline `isPending(plan)`, or
 * `isPending(session)` beside `session()`) is the hold's verdict reader that
 * pass (F-6, D-25): it reads the screen — signed out — and the branch, born
 * into the hold, asks for the signed-out fetch. That fetch derives from a
 * display-ahead read, so it does not hold the hold (F-6): the hold lands,
 * `params` re-derives at the landing (A15) and the branch shows rows.
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

type Shape = "split" | "one";
/** `split`: the hold's writes in one `flush()`, `plan`'s in the next. `one`:
 * all three in one `flush()`. */
function write(p: ReturnType<typeof page>, shape: Shape) {
  p.setGate(1);
  p.setSession("acc");
  if (shape === "split") flush();
  p.setPlan(true);
  flush();
}

for (const shape of ["split", "one"] as Shape[]) {
  for (const probe of ["plain read", "isPending", "latest"] as Probe[])
    it(`${probe} upstream of a held branch (${shape} flush): the branch reads the hold's session and the hold lands`, async () => {
      const p = page(probe);
      try {
        flush();
        expect(p.screen()).toBe("0 signed out");
        write(p, shape);
        // `chrome`'s value follows its own probe; `params` reads the hold's
        // `session` beside it.
        expect(p.branchSaw.at(-1)).toMatchObject({
          plan: probe !== "isPending",
          signedIn: true
        });
        expect(p.screen()).toBe("0 signed out");
        p.release();
        await tick();
        await tick();
        expect(p.screen()).toBe("1 rows");
      } finally {
        p.dispose();
      }
    });

  for (const probe of ["inline isPending", "same-node isPending"] as Probe[])
    it(`${probe} in params (${shape} flush): params reads the screen, and the hold lands (F-6)`, async () => {
      const p = page(probe);
      try {
        flush();
        write(p, shape);
        // A verdict reader this pass: the screen's session, signed out.
        expect(p.branchSaw.at(-1)).toMatchObject({ signedIn: false });
        expect(p.screen()).toBe("0 signed out");
        p.release();
        for (let i = 0; i < 4; i++) await tick();
        // Its signed-out fetch held nothing: the hold landed, and `params`
        // re-derived over the landed session.
        expect(p.branchSaw.at(-1)).toEqual(
          probe === "inline isPending"
            ? { plan: true, signedIn: true }
            : { plan: true, signedIn: true, busy: false }
        );
        expect(p.screen()).toBe("1 rows");
      } finally {
        p.dispose();
      }
    });
}

// A window's mark is the hold's: a staging asked of under one hold is not
// asked of under the next. `x` was probed (`latest(x)`) while hold 1 held it;
// hold 1 lands and the probe goes away. Under hold 2, `params` — a verdict
// reader only by reading `chrome` — reads hold 2's `x` as it would had `x`
// never been probed.
for (const shape of ["split", "one"] as Shape[])
  for (const probed of [false, true])
    it(`a probe under an earlier hold leaves no mark on the next (${probed ? "probed" : "never probed"}, ${shape} flush)`, async () => {
      const [x, setX] = createSignal(0);
      const [plan, setPlan] = createSignal(false);
      const [gate, setGate] = createSignal(0);
      const [ask, setAsk] = createSignal(probed);
      let release: () => void = () => {};
      const saw: number[] = [];
      let screen = "";
      const dispose = createRoot(d => {
        const held = createMemo(() => {
          const g = gate();
          return g === 0 ? g : new Promise<number>(r => (release = () => r(g)));
        });
        const asker = createMemo(() => (ask() ? latest(x) : -1));
        const chrome = createMemo(() => (isPending(plan), plan()));
        const params = createMemo(() => {
          chrome();
          const v = x();
          saw.push(v);
          return v;
        });
        createRenderEffect(
          () => `${held()} ${params()} ${asker()}`,
          v => void (screen = v)
        );
        return d;
      });
      try {
        flush();
        expect(screen).toBe(`0 0 ${probed ? 0 : -1}`);
        // Hold 1: `x` = 1, asked of while held when `probed`.
        setGate(1);
        setX(1);
        flush();
        release();
        await tick();
        await tick();
        expect(screen).toBe(`1 1 ${probed ? 1 : -1}`);
        setAsk(false);
        flush();
        expect(screen).toBe("1 1 -1");
        // Hold 2: `params` reads the hold's `x` either way.
        setGate(2);
        setX(2);
        if (shape === "split") flush();
        setPlan(true);
        flush();
        expect(saw.at(-1)).toBe(2);
        expect(screen).toBe("1 1 -1");
        release();
        await tick();
        await tick();
        expect(screen).toBe("2 2 -1");
      } finally {
        dispose();
      }
    });
