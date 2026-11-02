/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #4544 through `Show` + `Loading`. `chrome` owns the probe of an unrelated
// signal (A31 / D-25). `params`, holding the hold's staging of `session`, is
// that hold's work: the verdict posture it inherits by reading `chrome` does
// not serve it the committed `session`. The branch the hold opened reads the
// hold's session and the hold lands, in one `flush()` or several (F-10).
// A probe in `params`'s own body makes it the hold's verdict reader (F-6):
// it reads the screen, signed out; the signed-out fetch the branch then asks
// for holds nothing, the hold lands and `params` re-derives (A15).
import { expect, test } from "vitest";
import { render } from "@solidjs/web";
import { createMemo, createSignal, flush, isPending, latest, Loading, Show } from "solid-js";

const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flush();
};

type Probe = "plain read" | "isPending" | "latest" | "inline isPending" | "same-node isPending";
type Shape = "split" | "one";
type Params = { plan: boolean; signedIn: boolean; busy?: boolean };

async function arrive(probe: Probe, shape: Shape) {
  const [session, setSession] = createSignal<string | undefined>(undefined);
  const [plan, setPlan] = createSignal(false);
  const [gate, setGate] = createSignal(0);
  let release: () => void = () => {};
  const branchSaw: Params[] = [];
  const el = document.createElement("div");
  const dispose = render(() => {
    const held = createMemo(() => {
      const g = gate();
      return g === 0 ? g : new Promise<number>(r => (release = () => r(g)));
    });
    const chrome = createMemo(() =>
      probe === "isPending" ? (isPending(plan), plan()) : probe === "latest" ? latest(plan) : plan()
    );
    const params = createMemo(() =>
      probe === "same-node isPending"
        ? { plan: plan(), signedIn: session() !== undefined, busy: isPending(session) }
        : {
            plan: probe === "inline isPending" ? (isPending(plan), plan()) : chrome(),
            signedIn: session() !== undefined
          }
    );
    const signedOutOnly = createMemo(() => new Promise<never>(() => {}), { lazy: true });
    return (
      <Loading fallback={<i>root</i>}>
        <span>{held()}</span>
        <Show when={session() !== undefined} fallback={<i>signed out</i>}>
          <b>
            {(() => {
              const p = params();
              branchSaw.push(p);
              return p.signedIn ? "rows" : signedOutOnly();
            })()}
          </b>
        </Show>
      </Loading>
    );
  }, el);
  try {
    flush();
    expect(el.textContent).toBe("0signed out");
    setGate(1);
    setSession("acc");
    if (shape === "split") flush();
    setPlan(true);
    flush();
    return { el, branchSaw, release: () => release(), dispose };
  } catch (e) {
    dispose();
    throw e;
  }
}

for (const shape of ["split", "one"] as Shape[]) {
  for (const probe of ["plain read", "isPending", "latest"] as Probe[])
    test(`${probe} (${shape} flush): the branch the hold opens reads the hold's session and the hold lands`, async () => {
      const p = await arrive(probe, shape);
      try {
        expect(p.branchSaw.at(-1)).toMatchObject({ plan: probe !== "isPending", signedIn: true });
        expect(p.el.textContent).toBe("0signed out");
        p.release();
        await tick();
        await tick();
        expect(p.el.textContent).toBe("1rows");
      } finally {
        p.dispose();
      }
    });

  for (const probe of ["inline isPending", "same-node isPending"] as Probe[])
    test(`${probe} in params (${shape} flush): params reads the screen, and the hold lands (F-6)`, async () => {
      const p = await arrive(probe, shape);
      try {
        expect(p.branchSaw.at(-1)).toMatchObject({ signedIn: false });
        expect(p.el.textContent).toBe("0signed out");
        p.release();
        for (let i = 0; i < 4; i++) await tick();
        expect(p.branchSaw.at(-1)).toEqual(
          probe === "inline isPending"
            ? { plan: true, signedIn: true }
            : { plan: true, signedIn: true, busy: false }
        );
        expect(p.el.textContent).toBe("1rows");
      } finally {
        p.dispose();
      }
    });
}
