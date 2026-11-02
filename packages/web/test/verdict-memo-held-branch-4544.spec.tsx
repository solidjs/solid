/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #4544. `chrome` owns the probe of an unrelated signal and computes under
// that probe (A31 / D-25). `params`, holding the hold's staging of `session`,
// is that hold's work: a probe in its own body does not pull that staging
// out. The branch the hold opened reads `session` as signed in and the hold
// lands, without waiting on the signed-out fetch.
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
        signedOutIssued = true;
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
    return { el, branchSaw, signedOutIssued, release, dispose };
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

test("inline isPending(plan): the branch reads the hold's session and the hold lands without the signed-out fetch", async () => {
  const p = await arrive("inline isPending");
  try {
    expect(p.branchSaw.at(-1)).toMatchObject({ plan: false, signedIn: true });
    p.release();
    await tick();
    await tick();
    expect(p.el.querySelector("b")?.textContent).toBe("rows");
  } finally {
    p.dispose();
  }
});
