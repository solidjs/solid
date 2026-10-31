/**
 * #4544 — PROBE, ruling open (2026-10-31). A held update writes `session`
 * and opens a branch (`Show when={session() !== undefined}`) that exists only
 * for `session === "acc"`. Inside, the branch reads a pre-existing memo
 * `params = [chrome(), session() !== undefined]`; `chrome` reads an unrelated
 * signal `plan` that no hold holds. If `chrome` reads `plan` plainly,
 * `params` is the hold's derivation (D-1): on every pass — the held flush and
 * a later unrelated sync write to `plan` — it reads `"acc"`, the branch shows
 * `rows`, the hold lands. If `chrome` probes `plan` (`isPending`/`latest`),
 * or `params` probes it inline, `params` carries CONFIG_VERDICT (through
 * #4050's inheritance in the memo case) and `recompute`'s head refuses it
 * the join: its plain read of `session` is served the committed `undefined`
 * (`frameRead`/`stagedScreen`, seat row V1/V2), so the branch — born into
 * the hold — reads `signedOutOnly`, a lazy memo over a never-resolving
 * promise, and the hold waits on it forever.
 *
 * Two readings, not decided here:
 *  A (the reporter's): a verdict reader is the reader of the change it reads
 *    ahead of (F-6, A10, D-23's examples are all `[isPending(x), x()]`);
 *    `isPending(plan)` with `plan` unheld shows nothing ahead of the `session`
 *    hold, so `params` is that hold's plain derivation (D-1) and the branch
 *    reads `"acc"`. Today's screen is D-27's forbidden outcome — a plain
 *    read's answer depending on an unrelated probe somewhere upstream.
 *  B (the engine's seat table, INV-seat-2 "posture from the node alone";
 *    D-25 "the probe decides the pass's posture", "a verdict posture
 *    outlives the pass that asked … whoever dirtied it"): any probe makes the
 *    node a verdict reader; a verdict reader's plain read of a held node is
 *    the screen's. Then `signedIn: false` is the ruled value and the stuck
 *    hold is F-2 on a born-held branch that asked for async.
 *
 * Pinned `it.fails` at reading A's screen; invert to the ruled screen if B.
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

type Probe = "plain read" | "isPending" | "latest" | "inline isPending";

async function arrive(probe: Probe): Promise<string> {
  const [session, setSession] = createSignal<string | undefined>(undefined);
  const [plan, setPlan] = createSignal(false);
  const [gate, setGate] = createSignal(0);
  let release: () => void = () => {};
  let screen = "";
  const dispose = createRoot(dispose => {
    const held = createMemo(() => {
      const g = gate();
      return g === 0 ? g : new Promise<number>(r => (release = () => r(g)));
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
        const params = createMemo(() => ({
          plan: probe === "inline isPending" ? (isPending(plan), plan()) : chrome(),
          signedIn: session() !== undefined
        }));
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
              () => (params().signedIn ? "rows" : signedOutOnly()),
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
  try {
    flush();
    expect(screen).toBe("0 signed out");
    setGate(1);
    setSession("acc");
    flush();
    setPlan(true);
    flush();
    release();
    await tick();
    await tick();
    return screen;
  } finally {
    dispose();
  }
}

for (const probe of ["plain read", "isPending", "latest", "inline isPending"] as Probe[])
  (probe === "plain read" ? it : it.fails)(
    `${probe} of an unrelated signal upstream: the branch the hold opens reads the hold's session and the hold lands`,
    async () => {
      expect(await arrive(probe)).toBe("1 rows");
    }
  );
