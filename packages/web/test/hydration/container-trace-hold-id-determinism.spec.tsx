/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * Hydration-id determinism across the HOLD. Two trace-carrying fills
 * interleaved with two ordinary ones: the ordinary fills claim in the root
 * pass, the trace fills after the load. Every fill must claim its own
 * markup, and the page must hydrate identically whether the materializer
 * was resident at t=0 or arrived late — fills claim under prefix-scoped
 * owners (`sc-<fid>-<occurrence>-`, `claimRender`), so their keys never
 * depend on the ambient counter; what COULD differ is what the component
 * consumes from the ambient owner, which is the keyed siblings' business.
 *
 * The materializer's root used to be created under the reviving owner
 * (`createRoot` inherits a child id), so a resident revival at t=0 consumed
 * one root id PER TRACE and a late revival (no ambient owner) none — the
 * sibling after the frame hydrated under a different key in the two runs.
 * The root is detached now: id-neutral at any time.
 *
 * Lazy first, then resident: the install is process-global and one-way.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { createSignal, flush } from "solid-js";
import { hydrate } from "@solidjs/web";
import { installServerComponents } from "../../frames/src/client.js";
import {
  After,
  captureWarnings,
  cleanupHold,
  commentFill,
  expectClaimed,
  fakeLedger,
  FID,
  frameHtml,
  installRecords,
  makeGatedHost,
  makeResidentHost,
  mounts,
  mountShell,
  noteFill,
  P_AFTER,
  P_BEFORE,
  sleep,
  snapshotNodes,
  traceState
} from "./container-trace-hold-helpers.jsx";

describe("container-trace hold: id determinism", () => {
  afterEach(cleanupHold);

  let n = 0;
  async function run(mode: "lazy" | "resident", tail: string, page: (T: any) => any) {
    const fid = `${FID}/${mode}${++n}`;
    const ledger = fakeLedger();
    installRecords({ fid, hy: { fr: ledger.ledger } });
    const container = mountShell(P_BEFORE + frameHtml(fid) + tail);
    const before = snapshotNodes(container, fid);
    const warnings = captureWarnings();
    vi.stubGlobal("fetch", () => {
      throw new Error("fetch must not be called");
    });
    // The first lazy run holds on the production predicate; once a resident
    // run has installed the materializer, the forced hold stands in.
    const gated =
      mode === "lazy" ? makeGatedHost({ force: !!traceState()?.materializeTrace }) : undefined;
    installServerComponents(gated ? gated.host : makeResidentHost());
    // A second page in this worker: let the boundary index see it.
    ledger.reveal(container);
    const T = (globalThis as any)._$SC.r(fid);
    const dispose = hydrate(() => page(T), container);
    flush();
    if (gated) {
      // The pass claimed the ordinary fills and held the trace fills.
      expect(mounts.note).toEqual(["n1", "n2"]);
      expect(mounts.comment).toEqual([]);
      expect(gated.state.asks).toBeGreaterThanOrEqual(2);
      await gated.release();
    }
    await sleep(10);
    flush();
    return { container, before, warnings, dispose, fid };
  }

  const [label] = createSignal("after");

  test("lazy: ordinary fills claim in the pass, trace fills claim after the load", async () => {
    expect(traceState()?.materializeTrace).toBeUndefined();
    const r = await run("lazy", "", T => (
      <>
        <After text={label()} />
        <T comment={commentFill} note={noteFill} />
      </>
    ));
    expect(mounts.comment).toEqual(["c1", "c2"]);
    expect(mounts.note).toEqual(["n1", "n2"]);
    expectClaimed(r.container, r.before, r.fid);
    expect(r.before.before.textContent).toBe("after");
    expect(r.warnings).toEqual([]);
    r.dispose();
  });

  test("resident at t=0: the same claims, the same sibling key", async () => {
    const r = await run("resident", "", T => (
      <>
        <After text={label()} />
        <T comment={commentFill} note={noteFill} />
      </>
    ));
    expect(mounts.comment).toEqual(["c1", "c2"]);
    expect(mounts.note).toEqual(["n1", "n2"]);
    expectClaimed(r.container, r.before, r.fid);
    expect(r.warnings).toEqual([]);
    r.dispose();
  });

  test("the materializer consumes no ambient id: a sibling AFTER the frame keys the same in both runs", async () => {
    // One frame, two traces revived at t=0: with the old owned root the
    // trailing sibling landed two ids further on than with no trace at
    // all. Both runs must agree with each other; what they agree ON is the
    // component's own consumption (see the `.fails` pin below).
    const keys: string[] = [];
    for (const mode of ["lazy", "resident"] as const) {
      const r = await run(mode, P_AFTER, T => (
        <>
          <After text={label()} />
          <T comment={commentFill} note={noteFill} />
          <After text={label()} />
        </>
      ));
      const miss = r.warnings.find(w => w.includes("Hydration key miss"));
      keys.push(miss ? miss.match(/key miss for "([^"]+)"/)![1] : "claimed");
      r.dispose();
      cleanupHold();
    }
    expect(keys[0]).toBe(keys[1]);
  });

  // Pre-existing, independent of the hold (noted for the maintainer): the
  // server consumes root ids for the component (`NoHydration`'s owner in
  // `serverOwned`, and more depending on position — one when the component
  // is the first child, two after a keyed sibling), while the adopting
  // client component consumes none, so a keyed sibling AFTER a document
  // boundary misses its key. Flips when the client mirrors the server's
  // consumption.
  test.fails("a keyed sibling after the frame claims the server's node", async () => {
    const r = await run("resident", P_AFTER, T => (
      <>
        <After text={label()} />
        <T comment={commentFill} note={noteFill} />
        <After text={label()} />
      </>
    ));
    expect(r.warnings).toEqual([]);
    expect(r.container.querySelectorAll("p.after").length).toBe(2);
    r.dispose();
  });
});
