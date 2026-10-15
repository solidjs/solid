/**
 * @vitest-environment jsdom
 *
 * Replay pins of the GENERIC (frames-free) hydration harness —
 * `documentation/server-components/frames-consistency-contract.md`
 * §"Generic hydration — classification and pins (2026-10-06)". Each red is
 * a `test.fails` over the harness's own laws (so the pin is red for the
 * right reason), with the observed / expected frame in a comment, the
 * other fragment order where the invariant claims independence, and a
 * passing control. The page is plain Solid 2 — `hydrate()` over a
 * `renderToStream` document with two streamed `<Loading>` boundaries; no
 * frames, slots or records anywhere (test/harness/generic-hydration.tsx).
 *
 * Schedules read as in `describeScenario`: H hydrate, Cn the stream's n-th
 * chunk, W a client write to the module-level signal, P a push to the
 * module-level store list, Ea/Eb a click on a boundary's button, t a settle
 * point (20ms), m a microtask, X dispose.
 */
import { describe, expect, test } from "vitest";
import { runScenario, type Finding } from "./run.js";
import type { Event, Scenario } from "./scenario.js";
import { loadArtifact } from "./support.js";

function schedule(order: "ab" | "ba", spec: string): Scenario {
  const chunks = loadArtifact(order).chunks.length;
  const events: Event[] = spec.split(/\s+/).map(tok => {
    if (tok === "H") return { t: "hydrate" };
    if (tok === "W") return { t: "write" };
    if (tok === "P") return { t: "push" };
    if (tok === "t") return { t: "tick" };
    if (tok === "m") return { t: "micro" };
    if (tok === "X") return { t: "dispose" };
    if (tok === "Ea") return { t: "click", side: "a" };
    if (tok === "Eb") return { t: "click", side: "b" };
    if (/^C\d$/.test(tok)) return { t: "chunk", i: Number(tok.slice(1)) };
    throw new Error(`unknown token ${tok}`);
  });
  return { order, chunks, events };
}

const only = (findings: Finding[], id: string, law?: string) =>
  findings
    .filter(f => f.id === id && (!law || f.law === law))
    .map(f => `${f.id} ${f.law} @${f.step}: ${f.detail}`);

describe("GH1 — a derived source with no snapshot is read live by the resume's claim pass (C19 / #3504)", () => {
  // Observed: after the write, the shell shows `label:/b`; each boundary's
  // resume claims the server text `label:/a` while the memo it read says
  // `label:/b`, and nothing re-runs the hole until the memo changes again.
  // Expected (write-before-resume's contract): the boundary resumes against
  // the server snapshot, then catches up — `label:/b` once settled.
  test.fails(
    "C19 claim-shows-memo: module-level memo, write before both reveals — [ab] :: H W t C0 C1 C2 t",
    async () => {
      const r = await runScenario(schedule("ab", "H W t C0 C1 C2 t"));
      expect(only(r.findings, "C19", "claim-shows-memo")).toEqual([]);
    }
  );
  test.fails(
    "C19 claim-shows-memo: the other fragment order — [ba] :: H W t C0 C1 C2 t",
    async () => {
      const r = await runScenario(schedule("ba", "H W t C0 C1 C2 t"));
      expect(only(r.findings, "C19", "claim-shows-memo")).toEqual([]);
    }
  );
  test.fails(
    "C19 claim-shows-memo: write between the two reveals — the later boundary is stale — [ab] :: H C0 C1 t W t C2 t",
    async () => {
      const r = await runScenario(schedule("ab", "H C0 C1 t W t C2 t"));
      expect(
        only(r.findings, "C19", "claim-shows-memo").filter(m => m.includes("b.label"))
      ).toEqual([]);
    }
  );
  test("control: the boundary that resumed BEFORE the write is live and catches up — [ab] :: H C0 C1 t W t C2 t", async () => {
    const r = await runScenario(schedule("ab", "H C0 C1 t W t C2 t"));
    expect(only(r.findings, "C19", "claim-shows-memo").filter(m => m.includes("a.label"))).toEqual(
      []
    );
  });
  // The plain signal beside it (`.raw`) is snapshot-captured on its first
  // write and catches up — the control that shows the rule exists.
  test("control: the plain signal read beside the memo resumes on the snapshot and catches up", async () => {
    const r = await runScenario(schedule("ab", "H W t C0 C1 C2 t"));
    expect(only(r.findings, "C19", "claim-shows-signal")).toEqual([]);
  });
  test("control: no write — every hole shows its source", async () => {
    const r = await runScenario(schedule("ab", "H C0 C1 C2 t"));
    expect(only(r.findings, "C19")).toEqual([]);
  });
});

describe("GH2 — a shell async memo adopted pending, re-run by a write before a later boundary resumes (C19)", () => {
  // `shared` is pending when the shell flushes (read only under the
  // boundaries): the client adopts it with no creation-time snapshot. It
  // lands `shared:/a` with the first fragment; a write re-runs it to
  // `shared:/b` (the shell and the resumed boundary update); the second
  // boundary then resumes reading `shared:/b` and claims the server text
  // `shared:/a` — stale until the memo changes again.
  test.fails("C19 claim-shows-async-memo: [ab] :: H C0 C1 t W t C2 t", async () => {
    const r = await runScenario(schedule("ab", "H C0 C1 t W t C2 t"));
    expect(only(r.findings, "C19", "claim-shows-async-memo")).toEqual([]);
  });
  test.fails(
    "C19 claim-shows-async-memo: the other fragment order — [ba] :: H C0 C1 t W t C2 t",
    async () => {
      const r = await runScenario(schedule("ba", "H C0 C1 t W t C2 t"));
      expect(only(r.findings, "C19", "claim-shows-async-memo")).toEqual([]);
    }
  );
  test("control: write after both resumed — both boundaries catch up", async () => {
    const r = await runScenario(schedule("ab", "H C0 C1 C2 t W t"));
    expect(only(r.findings, "C19", "claim-shows-async-memo")).toEqual([]);
  });
});

describe("GH3 — a store write to a leaf no reader has materialized is not snapshotted (C19 / C1)", () => {
  // The push mutates the raw array (no `length` leaf exists yet; nothing in
  // the shell read it). At the resume `<For>` creates the leaf with the
  // post-write length, renders three rows against two server rows: a
  // hydration key miss for the third (a detached `<li>`, the warning blames
  // id namespaces) and a list one row short until the next structural
  // change. With the leaf materialized before the write (a shell reader of
  // `items.length`) the resume claims two rows and catches up to three.
  test.fails(
    "C19 claim-shows-store-list: push before the reveals — [ab] :: H P C0 C1 C2 t",
    async () => {
      const r = await runScenario(schedule("ab", "H P C0 C1 C2 t"));
      expect(only(r.findings, "C19", "claim-shows-store-list")).toEqual([]);
    }
  );
  test.fails("C1 no-key-miss: the third row misses its key — [ab] :: H P C0 C1 C2 t", async () => {
    const r = await runScenario(schedule("ab", "H P C0 C1 C2 t"));
    expect(only(r.findings, "C1", "no-key-miss").filter(m => m.includes("<li>"))).toEqual([]);
  });
  test.fails(
    "C19 claim-shows-store-list: the other fragment order — [ba] :: H P C0 C1 C2 t",
    async () => {
      const r = await runScenario(schedule("ba", "H P C0 C1 C2 t"));
      expect(only(r.findings, "C19", "claim-shows-store-list")).toEqual([]);
    }
  );
  test("control: push after both resumed — both lists update, no key miss", async () => {
    const r = await runScenario(schedule("ab", "H C0 C1 C2 t P t"));
    expect(only(r.findings, "C19", "claim-shows-store-list")).toEqual([]);
    expect(only(r.findings, "C1")).toEqual([]);
  });
});

describe("GH4 — a boundary resuming while a shell async source is in flight shows its fallback over the settled content (C9 / C12 / events)", () => {
  // The write re-runs `shared` (the server's pending answer is superseded;
  // the client flight takes 15ms). The boundary's resume renders its
  // content, reads `shared` pending, and — never having revealed on the
  // client — falls back: the fallback is claimed in the window (a key miss
  // for `<p class="fb a">`, a phantom), then the snapshot release re-runs
  // the insert outside the window and COMMITS it: the server `<section>` is
  // detached and a fresh client fallback stands in its place until `shared`
  // lands, when the same server nodes are re-attached. Expected: the
  // settled server content is the boundary's revealed value; a pending
  // read holds it (async-holds-latest), no fallback, no detach.
  test.fails("C9 no-fallback-over-settled: [ab] :: H W C0 C1 m t", async () => {
    const r = await runScenario(schedule("ab", "H W C0 C1 m t"));
    expect(only(r.findings, "C9")).toEqual([]);
  });
  test.fails(
    "C9 no-fallback-over-settled: the other fragment order — [ba] :: H W C0 C1 m t",
    async () => {
      const r = await runScenario(schedule("ba", "H W C0 C1 m t"));
      expect(only(r.findings, "C9")).toEqual([]);
    }
  );
  test.fails(
    "C1 no-key-miss: the fallback is claimed in the resume window — [ab] :: H W C0 C1 m t",
    async () => {
      const r = await runScenario(schedule("ab", "H W C0 C1 m t"));
      expect(only(r.findings, "C1", "no-key-miss").filter(m => m.includes("fb a"))).toEqual([]);
    }
  );
  // A click queued on the server section while it is detached replays into
  // nothing (the walk from the detached button never reaches the delegated
  // container) and is consumed.
  test.fails(
    "E queued-click-replays-once: a click queued at the reveal is lost — [ab] :: H W m C0 C1 C2 Eb",
    async () => {
      const r = await runScenario(schedule("ab", "H W m C0 C1 C2 Eb"));
      expect(only(r.findings, "E")).toEqual([]);
    }
  );
  test("control: the server nodes come back once the flight lands (node identity, parity at the settle point)", async () => {
    const r = await runScenario(schedule("ab", "H W C0 C1 m t"));
    expect(only(r.findings, "C1", "node-identity")).toEqual([]);
    expect(only(r.findings, "C12")).toEqual([]);
  });
  test("control: no write — the resume holds the content, the click replays", async () => {
    const r = await runScenario(schedule("ab", "H m C0 C1 C2 Eb t"));
    expect(only(r.findings, "C9")).toEqual([]);
    expect(only(r.findings, "E")).toEqual([]);
    expect(only(r.findings, "C1")).toEqual([]);
  });
});

describe("generic holds — what the harness could not break (1000 cases, two seeds)", () => {
  test("C14: dispose while both boundaries are pending — the late chunks touch nothing, nothing runs", async () => {
    const r = await runScenario(schedule("ab", "H X C0 C1 C2 t"));
    expect(only(r.findings, "C14")).toEqual([]);
    expect(only(r.findings, "G")).toEqual([]);
  });
  test("C14: dispose between the reveals", async () => {
    const r = await runScenario(schedule("ba", "H C0 C1 X C2 t"));
    expect(only(r.findings, "C14")).toEqual([]);
    expect(only(r.findings, "G")).toEqual([]);
  });
  test("C3: hydration-done waits for both streamed boundaries, in either order", async () => {
    for (const order of ["ab", "ba"] as const) {
      const r = await runScenario(schedule(order, "H C0 t C1 t C2 t"));
      expect(only(r.findings, "C3")).toEqual([]);
    }
  });
  test("C12 / C10: a fully loaded page (every chunk before hydrate) claims both fragments in place", async () => {
    const r = await runScenario(schedule("ab", "C0 C1 C2 H t"));
    expect(only(r.findings, "C12")).toEqual([]);
    expect(only(r.findings, "C1")).toEqual([]);
  });
  test("E: a click queued before hydrate on a settled fragment replays once at the claim", async () => {
    const r = await runScenario(schedule("ab", "C0 C1 C2 Ea Eb H t"));
    expect(only(r.findings, "E")).toEqual([]);
  });
});
