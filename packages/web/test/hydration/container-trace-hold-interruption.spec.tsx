/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * Interruptions DURING the hold. The frame holds a trace-carrying occurrence
 * until the host's `prepareArgs` promise settles, then re-syncs
 * (`#argsUnprepared` → `#syncSlots`). Three things can happen in between:
 *
 *  (a) the occurrence's record is REPLACED — a refetch of the same call
 *      (a higher-version slot write), or an address switch re-binding the
 *      frame to another call's store. The hold is the t=0 mount deferred, and
 *      the outcome must be what a resident run shows: ONE mount — the claim,
 *      with the record the server interior was rendered from (the held one)
 *      — followed by the replacement applied as the args change it is, so
 *      the DOM ends on the new values. (Claiming with the NEW args instead
 *      would trust markup rendered from the old ones; a claim never rewrites
 *      a text hole, so every differing text would stay stale for good.);
 *  (b) the frame is DISPOSED — the continuation checks `#disposed` and the
 *      settlement is a no-op (no mount, no error);
 *  (c) two occurrences wait on the same load — one pending promise per
 *      frame (`#argsRefresh`), one re-sync, both mount.
 *
 * Lazy from the first test on: the install is one-way per worker, so the
 * later tests hold through the host's own predicate (`force`).
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { createSignal, flush } from "solid-js";
import { hydrate } from "@solidjs/web";
import { createStream } from "seroval";
import { installServerComponents } from "../../frames/src/client.js";
import {
  After,
  captureWarnings,
  cleanupHold,
  commentFill,
  fakeLedger,
  FID,
  frameHtml,
  installRecords,
  makeGatedHost,
  mounts,
  mountShell,
  noteFill,
  P_BEFORE,
  sleep,
  snapshotNodes,
  traceState
} from "./container-trace-hold-helpers.jsx";

describe("container-trace hold: interruptions", () => {
  afterEach(cleanupHold);

  let n = 0;
  function setup(emit?: Parameters<typeof installRecords>[0]["emit"]) {
    const fid = `${FID}/int${++n}`;
    const ledger = fakeLedger();
    const streams = installRecords({ fid, emit, hy: { fr: ledger.ledger } });
    const container = mountShell(P_BEFORE + frameHtml(fid));
    const before = snapshotNodes(container, fid);
    const warnings = captureWarnings();
    vi.stubGlobal("fetch", () => {
      throw new Error("fetch must not be called");
    });
    const gated = makeGatedHost({ force: !!traceState()?.materializeTrace });
    installServerComponents(gated.host);
    ledger.reveal(container);
    const T = (globalThis as any)._$SC.r(fid);
    const [label] = createSignal("after");
    const dispose = hydrate(
      () => (
        <>
          <After text={label()} />
          <T comment={commentFill} note={noteFill} />
        </>
      ),
      container
    );
    flush();
    // Held: ordinary fills claimed, trace fills waiting.
    expect(mounts.note).toEqual(["n1", "n2"]);
    expect(mounts.comment).toEqual([]);
    expect(gated.state.asks).toBeGreaterThanOrEqual(2);
    return { fid, container, before, warnings, gated, dispose, streams };
  }

  test("(a) a refetch replaces the record while held: one mount (the claim, with the held args), then the replacement applies", async () => {
    const s = setup();
    // The refetch's stream (same call, next version) carries a new record
    // for `comment#c1` — new args, a new trace — and the same `comment#c2`.
    const v2 = createStream<any>();
    v2.next({ name: "Ada (v2)" });
    s.gated.host.apply({
      type: "slot",
      id: s.fid,
      version: 1,
      key: "comment#c1",
      args: { cid: "c1v2", user: { $tr: v2, $ta: 0 } }
    } as any);
    flush();
    expect(mounts.comment).toEqual([]);

    await s.gated.release();
    await sleep(10);
    flush();
    // One mount per occurrence, with the HELD args (the claim); the
    // replacement arrived as a props update, not a second mount.
    expect(mounts.comment.sort()).toEqual(["c1", "c2"]);
    // Claimed (the markup is the range's), updated to the new record's
    // values by the live mount.
    expect(s.container.querySelector(`[_hk="sc-${s.fid}-comment#c1-0"]`)).toBe(s.before.c1);
    expect(s.before.c1.querySelector("b")!.textContent).toBe("c1v2");
    expect(s.before.c1name.textContent).toBe("Ada (v2)");
    expect(s.before.c2name.textContent).toBe("Grace");
    expect(s.container.querySelectorAll(".c").length).toBe(2);
    expect(s.warnings).toEqual([]);
    s.dispose();
  });

  test("(a') an address switch re-binds the frame while held: the new address's record mounts, once", async () => {
    const s = setup();
    const address = `${s.fid}:switched`;
    // The other call's store, warm: the full record set under its address.
    const sw = createStream<any>();
    sw.next({ name: "Switched" });
    const seed = [
      { key: "comment#c1", args: { cid: "c1s", user: { $tr: sw, $ta: 0 } } },
      { key: "note#0", args: { text: "n1" } },
      { key: "comment#c2", args: { cid: "c2", user: { $tr: s.streams.c2, $ta: 0 } } },
      { key: "note#1", args: { text: "n2" } }
    ];
    for (const r of seed)
      s.gated.host.apply({ type: "slot", id: address, version: 0, ...r } as any);
    const frame = s.gated.host.get(s.fid)!;
    expect(frame).toBeTruthy();
    frame.rebind(address);
    flush();
    expect(s.gated.host.get(address)).toBe(frame);
    expect(s.gated.host.get(s.fid)).toBeUndefined();
    expect(mounts.comment).toEqual([]);

    await s.gated.release();
    await sleep(10);
    flush();
    expect(mounts.comment.sort()).toEqual(["c1", "c2"]);
    expect(s.container.querySelector(`[_hk="sc-${s.fid}-comment#c1-0"]`)).toBe(s.before.c1);
    expect(s.before.c1.querySelector("b")!.textContent).toBe("c1s");
    expect(s.before.c1name.textContent).toBe("Switched");
    expect(s.container.querySelectorAll(".c").length).toBe(2);
    expect(s.warnings).toEqual([]);
    s.dispose();
  });

  test("(b) the frame is disposed while held: the settlement is a no-op", async () => {
    const s = setup();
    s.dispose();
    expect(s.gated.host.get(s.fid)).toBeUndefined();
    await s.gated.release();
    await sleep(10);
    flush();
    expect(mounts.comment).toEqual([]);
    expect(s.warnings).toEqual([]);
    s.container.remove();
  });

  test("(c) two occurrences on one load: one pending step, one re-sync, both mount", async () => {
    const s = setup();
    // Both occurrences asked, on every sync that saw them held (the adopt
    // sync and the registration-flush drain); the host answers each ask
    // with the SAME promise and the frame keeps one continuation for it.
    const asks = s.gated.state.asks;
    expect(asks).toBeGreaterThanOrEqual(2);
    await s.gated.release();
    await sleep(10);
    flush();
    expect(mounts.comment).toEqual(["c1", "c2"]);
    // Nothing asks again once the step settled.
    expect(s.gated.state.asks).toBe(asks);
    expect(s.warnings).toEqual([]);
    s.dispose();
  });
});
