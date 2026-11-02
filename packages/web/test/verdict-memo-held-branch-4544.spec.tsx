/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #4544. The memo form and the inline form differ because a memo's value is
// one slot under its own posture (A31 / D-25). `chrome` owns the probe of
// an unrelated signal; `params`, holding the hold's staging of `session`,
// is that hold's work — an inherited posture does not pull it out. A probe
// in `params`'s own body still does, and the signed-out fetch it issues
// resolves before the hold lands.
import { expect, test } from "vitest";
import { render } from "@solidjs/web";
import { createMemo, createSignal, flush, isPending, latest, Loading, Show } from "solid-js";

const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flush();
};

type Probe = "plain read" | "isPending" | "latest" | "inline isPending";
type Params = { plan: boolean; signedIn: boolean };

async function arrive(probe: Probe) {
  const [session, setSession] = createSignal<string | undefined>(undefined);
  const [plan, setPlan] = createSignal(false);
  const [gate, setGate] = createSignal(0);
  let release: () => void = () => {};
  const branchSaw: Params[] = [];
  let signedOutIssued = false;
  let resolveSignedOut: (v: string) => void = () => {};
  const signedOut = new Promise<string>(r => (resolveSignedOut = r));
  const el = document.createElement("div");
  const dispose = render(() => {
    const held = createMemo(() => {
      const g = gate();
      return g === 0 ? g : new Promise<number>(r => (release = () => r(g)));
    });
    const chrome = createMemo(() =>
      probe === "isPending" ? (isPending(plan), plan()) : probe === "latest" ? latest(plan) : plan()
    );
    const params = createMemo(() => ({
      plan: probe === "inline isPending" ? (isPending(plan), plan()) : chrome(),
      signedIn: session() !== undefined
    }));
    const signedOutOnly = createMemo(
      () => {
        if (probe === "inline isPending") {
          signedOutIssued = true;
          return signedOut;
        }
        return new Promise<never>(() => {});
      },
      { lazy: true }
    );
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
    flush();
    setPlan(true);
    flush();
    return { el, branchSaw, signedOutIssued, resolveSignedOut, release, dispose };
  } catch (e) {
    dispose();
    throw e;
  }
}

for (const probe of ["plain read", "isPending", "latest"] as Probe[])
  test(`${probe}: the branch the hold opens reads the hold's session and the hold lands`, async () => {
    const p = await arrive(probe);
    try {
      expect(p.branchSaw.at(-1)).toMatchObject({
        plan: probe === "isPending" ? false : true,
        signedIn: true
      });
      p.release();
      await tick();
      await tick();
      expect(p.el.querySelector("b")?.textContent).toBe("rows");
    } finally {
      p.dispose();
    }
  });

test("inline isPending: the pass's own probe wins and the hold lands after the signed-out fetch", async () => {
  const p = await arrive("inline isPending");
  try {
    expect(p.branchSaw.at(-1)).toMatchObject({ plan: false, signedIn: false });
    expect(p.signedOutIssued).toBe(true);
    expect(p.el.textContent).toContain("signed out");
    p.resolveSignedOut("out");
    p.release();
    await tick();
    await tick();
    expect(p.el.querySelector("b")?.textContent).toBe("rows");
  } finally {
    p.dispose();
  }
});
