/**
 * @vitest-environment jsdom
 *
 * Reduced counterexamples the campaign found, replayed through the same
 * runner as named pins. Reds stay `test.fails` with the invariant id in the
 * title and the observed/expected in a comment; the controls pass. Not
 * opt-in: these run with the consistency suite.
 */
import { describe, expect, test } from "vitest";
import { runScenario } from "./run.js";
import type { Scenario } from "./scenario.js";

const render = (i: number, inFragment: number | null = null): Scenario["occurrences"][0] => ({
  name: `item#${i}`,
  kind: "render",
  arg: { kind: "plain" },
  inFragment
});
const trace = (i: number, snapshot: number, patches: number[]): Scenario["occurrences"][0] => ({
  name: `item#${i}`,
  kind: "render",
  arg: { kind: "trace", snapshot, patches },
  inFragment: null
});
const H = { t: "hydrate" } as const;
const R = (occ: number) => ({ t: "record", occ }) as const;
const V = (frag: number) => ({ t: "reveal", frag }) as const;
const T = (occ: number, patch = 0) => ({ t: "trace", occ, patch }) as const;
const L = (html: string) => ({ t: "live", html }) as const;
const tick = { t: "tick" } as const;

const base = { fragments: [], liveHole: false, late: "none" as const };

async function findings(scenario: Scenario, id: string) {
  const r = await runScenario(scenario);
  return r.findings.filter(f => f.id === id).map(f => `${f.law}: ${f.detail}`);
}

describe("harness replay — reduced counterexamples", () => {
  // C18 — classification waits for the drain. Was red on `next`: with two
  // records owed after adoption and the parser done before the deferred
  // drain fired, the drain's FIRST `host.apply` synced the frame, which
  // found the second occurrence recordless with `recordsPending()` false
  // and classified it direct-insert — the render prop was evaluated as a
  // zero-arg accessor (1 zero-arg call). Green since the occurrence's NAME
  // decides its class (`item#1` is a call; its record is on its way) and a
  // called occurrence without its record waits — the ambiguity the
  // classification turned on no longer exists, whatever `recordsPending()`
  // answers; the drain's next apply mounts it.
  test("C18 classify-after-drain: two records drained after the parser finished — the first apply classifies the second", async () => {
    expect(
      await findings(
        { ...base, occurrences: [render(0), render(1)], events: [H, R(0), R(1)] },
        "C18"
      )
    ).toEqual([]);
  });

  // C18, second trigger: a live hole op arriving between the parser's end
  // and the deferred drain syncs the frame; the one record sits undrained
  // in `_$HY.r`. Was: 1 zero-arg call. Expected: 0.
  test("C18 classify-after-drain: a live op syncs the frame before the deferred drain", async () => {
    expect(
      await findings(
        { ...base, occurrences: [render(0)], liveHole: true, events: [H, R(0), L("ab"), tick] },
        "C18"
      )
    ).toEqual([]);
  });

  // C18, third trigger: ops logged before adoption replay through the live
  // pump's first async read — after the record landed, before the drain.
  // Was: 1 zero-arg call. Expected: 0.
  test("C18 classify-after-drain: the live pump's catch-up read syncs before the drain", async () => {
    expect(
      await findings(
        {
          ...base,
          occurrences: [render(0)],
          liveHole: true,
          events: [L("ab"), L("cd"), H, R(0), tick]
        },
        "C18"
      )
    ).toEqual([]);
  });

  // C18 control: a tick between the two records lets the drain run while the
  // parser is still owed the second — each sync finds `recordsPending()` true.
  test("C18 control: a drain per record while the parser is still running classifies nothing early", async () => {
    expect(
      await findings(
        { ...base, occurrences: [render(0), render(1)], events: [H, R(0), tick, R(1)] },
        "C18"
      )
    ).toEqual([]);
  });

  // C19 — a claim shows the oracle, not the snapshot. Observed on `next`:
  // a trace patch delivered BEFORE the fill claims leaves the server text
  // (the snapshot's `2`) on screen although the fill's first read is the
  // patched `5`; the DOM catches up only at the next patch. Expected: the
  // claimed text equals the value the fill read. Any order where the patch
  // precedes the claim fails: record→patch→hydrate, patch→record→hydrate,
  // hydrate→patch→record (deferred claim).
  test.fails(
    "C19 claim-shows-oracle: a trace patch before the claim is not shown (record, patch, hydrate)",
    async () => {
      expect(
        await findings({ ...base, occurrences: [trace(0, 2, [3])], events: [R(0), T(0), H] }, "C19")
      ).toEqual([]);
    }
  );
  test.fails(
    "C19 claim-shows-oracle: a trace patch before the claim is not shown (hydrate, patch, record)",
    async () => {
      expect(
        await findings({ ...base, occurrences: [trace(0, 2, [3])], events: [H, T(0), R(0)] }, "C19")
      ).toEqual([]);
    }
  );

  // C19 control: a patch after the claim lands (C11 proper).
  test("C19 control: a patch after the claim shows", async () => {
    const r = await runScenario({
      ...base,
      occurrences: [trace(0, 2, [3])],
      events: [R(0), H, tick, T(0), tick]
    });
    expect(r.findings.filter(f => f.id === "C19" || f.id === "C11")).toEqual([]);
  });

  // C2 (R3, rediscovered): an occurrence inside a server <Loading> whose
  // record is in the page before adoption and whose fragment reveals AFTER
  // adoption never mounted — the reveal was not a sync trigger. Was:
  // invoked 0×, inert after the bump. Green under frames-rulings 2.3 (a
  // reveal is an apply): invoked once, live.
  test("C2 every-range-live: a fragment revealed after adoption leaves its occurrence inert (R3)", async () => {
    expect(
      await findings(
        {
          ...base,
          fragments: [{ key: "f0", fallback: "fb0" }],
          occurrences: [render(0, 0)],
          events: [R(0), H, tick, V(0)]
        },
        "C2"
      )
    ).toEqual([]);
  });

  // C3 (R1, rediscovered): hydration-end fired while the deferred
  // occurrence was still unclaimed. Was: end at step 0 with item#0 mounted
  // and uninvoked. Green under frames-rulings 3.1/3.2 (the frame's hold is
  // a pending boundary): none.
  test("C3 done-counts-holds: hydration-end fires before the deferred record claim (R1)", async () => {
    expect(await findings({ ...base, occurrences: [render(0)], events: [H, R(0)] }, "C3")).toEqual(
      []
    );
  });

  // Smoke: the canonical order — records, hydrate — holds every law.
  test("smoke: records before hydrate, no fragments: no finding", async () => {
    const r = await runScenario({
      ...base,
      occurrences: [
        render(0),
        render(1),
        { name: "children", kind: "direct", arg: { kind: "plain" }, inFragment: null }
      ],
      events: [R(0), R(1), H, tick]
    });
    expect(r.findings).toEqual([]);
  });
});
