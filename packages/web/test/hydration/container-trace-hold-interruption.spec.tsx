/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * Interruptions DURING the hold. The frame holds a trace-carrying occurrence
 * until the traces tier's load settles, then re-syncs (the install's flush of
 * every live frame → `#syncSlots`). Three things can happen in between:
 *
 *  (a) the occurrence's record is REPLACED — a refetch of the same call
 *      (a higher-version slot write), or an address switch re-binding the
 *      frame to another call's store. The hold is the t=0 mount deferred, and
 *      the outcome must be what a resident run shows: ONE mount — the claim,
 *      with the record the server interior was rendered from (the held one,
 *      `#heldRecords`) — followed by the replacement applied as the args
 *      change it is, so the DOM ends on the new values. (Claiming with the
 *      NEW args instead would trust markup rendered from the old ones; a
 *      claim never rewrites a text hole, so every differing text would stay
 *      stale for good — frames-rulings 3.6.);
 *  (b) the frame is DISPOSED — the install's flush skips it (it left the
 *      live set) and the settlement is a no-op (no mount, no error);
 *  (c) two occurrences wait on the same load — one load per name
 *      (`prepareTier` is idempotent), one re-sync, both mount.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { createSignal, flush } from "solid-js";
import { hydrate } from "@solidjs/web";
import { createStream } from "seroval";
import {
  After,
  captureWarnings,
  cleanupHold,
  commentFill,
  fakeLedger,
  FID,
  frameHtml,
  gateTraceTier,
  installRecords,
  mounts,
  mountShell,
  noteFill,
  P_BEFORE,
  sleep,
  snapshotNodes,
  type Streams
} from "./container-trace-hold-helpers.jsx";

describe("container-trace hold: interruptions", () => {
  afterEach(cleanupHold);

  let n = 0;
  function setup(emit?: (s: Streams) => void) {
    const fid = `${FID}/int${++n}`;
    const ledger = fakeLedger();
    const streams = installRecords({ fid, emit, hy: { fr: ledger.ledger } });
    const container = mountShell(P_BEFORE + frameHtml(fid));
    const before = snapshotNodes(container, fid);
    const warnings = captureWarnings();
    vi.stubGlobal("fetch", () => {
      throw new Error("fetch must not be called");
    });
    const gated = gateTraceTier();
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
    // Held: ordinary fills claimed, trace fills waiting, the load asked once.
    expect(mounts.note).toEqual(["n1", "n2"]);
    expect(mounts.comment).toEqual([]);
    expect(gated.loader).toHaveBeenCalledTimes(1);
    return { fid, container, before, warnings, gated, dispose, streams };
  }

  test("(a) a refetch replaces the record while held: one mount (the claim, with the held args), then the replacement applies", async () => {
    const s = setup();
    // The refetch's stream (same call, next version — the store is one
    // response's, frames-rulings 1.1 / 1.4: the bump replaces the records
    // wholesale, so the response carries every occurrence's) — a new record
    // for `comment#c1` (new args, a new trace), the others re-sent equal.
    const v2 = createStream<any>();
    v2.next({ name: "Ada (v2)" });
    const refetch = [
      { key: "comment#c1", args: { cid: "c1v2", user: { $tr: v2, $ta: 0 } } },
      { key: "note#0", args: { text: "n1" } },
      { key: "comment#c2", args: { cid: "c2", user: { $tr: s.streams.c2, $ta: 0 } } },
      { key: "note#1", args: { text: "n2" } }
    ];
    for (const r of refetch)
      s.gated.host.apply({ type: "slot", id: s.fid, version: 1, ...r } as any);
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

  test("(c) two occurrences on one load: one import, one re-sync, both mount", async () => {
    const s = setup();
    // Both occurrences were found held on every sync that saw them (the
    // adopt sync and the registration-flush drain); `prepareTier` answered
    // each ask with the same load.
    expect(s.gated.loader).toHaveBeenCalledTimes(1);
    await s.gated.release();
    await sleep(10);
    flush();
    expect(mounts.comment).toEqual(["c1", "c2"]);
    // Nothing asks again once the tier is resident.
    expect(s.gated.loader).toHaveBeenCalledTimes(1);
    expect(s.warnings).toEqual([]);
    s.dispose();
  });
});
