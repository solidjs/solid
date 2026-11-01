/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #4544 through `Show` + `Loading` (the signals pin is
 * `signals/tests/verdict-memo-held-branch-4544.test.ts`, where the rows are
 * written up). A held update (an async memo under the root <Loading>)
 * writes `session` and opens `<Show when={session() !== undefined}>`. Inside,
 * a pre-existing `params` memo reads `session` and a `chrome` memo; `chrome`
 * reads an unrelated, unheld signal `plan`. Plain, `params` reads `"acc"` and
 * the hold lands on `rows`. With `isPending(plan)`/`latest(plan)` in `chrome`
 * the ruling (2026-10-31) is the same screen — a probe of a node no hold
 * holds earns no posture — and today's screen is still the reporter's: on
 * the `plan` write's flush `chrome` becomes the hold's verdict reader
 * (D-22's provisional verdict, the write having joined the hold through
 * `params`), `params` inherits the posture over the staging it holds (#4050,
 * D-25 as ruled 2026-11-01) and is served the committed `undefined`; the
 * born-held branch reads a never-resolving lazy memo and the hold never
 * lands. Pinned `it.fails` at the ruled screen; the conflict is the signals
 * pin's to describe.
 */
import { expect, it } from "vitest";
import { Loading, Show, createMemo, createSignal, isPending, latest } from "solid-js";
import { render } from "../src/index.js";

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const NEVER = new Promise<never>(() => {});

type Probe = "plain read" | "isPending" | "latest";

async function arrive(probe: Probe): Promise<string | null | undefined> {
  const [session, setSession] = createSignal<string | undefined>(undefined);
  const [plan, setPlan] = createSignal(false);
  const [gate, setGate] = createSignal(0);
  let release: () => void = () => {};

  function Page() {
    const chrome = createMemo(() =>
      probe === "isPending" ? (isPending(plan), plan()) : probe === "latest" ? latest(plan) : plan()
    );
    const params = createMemo(() => ({ plan: chrome(), signedIn: session() !== undefined }));
    const signedOutOnly = createMemo(() => NEVER, { lazy: true });
    return (
      <Show when={session() !== undefined} fallback={<i>signed out</i>}>
        <b>{params().signedIn ? "rows" : signedOutOnly()}</b>
      </Show>
    );
  }
  const held = createMemo(() => {
    const g = gate();
    return g === 0 ? g : new Promise<number>(r => (release = () => r(g)));
  });

  const el = document.createElement("div");
  const dispose = render(
    () => (
      <Loading fallback={<i>root</i>}>
        <span>{held()}</span>
        <Page />
      </Loading>
    ),
    el
  );
  try {
    await wait(10);
    setGate(1);
    setSession("acc");
    await wait(5);
    setPlan(true);
    await wait(5);
    release();
    await wait(50);
    return el.querySelector("b")?.textContent ?? el.querySelector("i")?.textContent;
  } finally {
    dispose();
  }
}

for (const probe of ["plain read", "isPending", "latest"] as Probe[])
  (probe === "plain read" ? it : it.fails)(
    `${probe} of an unrelated signal upstream: the branch the hold opens reads the hold's session and the hold lands`,
    async () => {
      expect(await arrive(probe)).toBe("rows");
    }
  );
