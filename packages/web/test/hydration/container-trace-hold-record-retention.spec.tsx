/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * Record retention across the hold. The adopted boundary drains the
 * document's `sc:slot:` records into the frame's store once per key
 * (`adoptBoundary.drainRecords`, `appliedRecords`), and the frame keeps the
 * record under `slot:<occurrence>` until the occurrence mounts or leaves.
 * While an occurrence is HELD, the document keeps doing what it does:
 *
 *  - reveals re-drain (`fr.subscribe` → `drainRecords`) — the held key is
 *    already applied, so the re-drain must neither re-apply nor drop it;
 *  - a later data script pushes a NEW key into `_$HY.r` — the re-drain
 *    applies that one, and only that one;
 *  - the live channel (`sc:live`) re-sends the occurrence's record with the
 *    same marker — a store write with equal args, which must not disturb
 *    the hold or double-mount at release.
 *
 * At release the held occurrence mounts exactly once, from its record.
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
  mounts,
  mountShell,
  noteFill,
  P_BEFORE,
  sleep,
  snapshotNodes
} from "./container-trace-hold-helpers.jsx";

describe("container-trace hold: record retention", () => {
  afterEach(cleanupHold);

  test("re-drains and a live re-send during the hold apply the held record once", async () => {
    const fid = `${FID}/retain`;
    const ledger = fakeLedger();
    // The live channel, as the document's first script creates it: a
    // ReadableStream of ops the client pumps.
    let liveController!: ReadableStreamDefaultController<any>;
    const live = new ReadableStream<any>({
      start(c) {
        liveController = c;
      }
    });
    installRecords({ fid, hy: { fr: ledger.ledger } });
    const hy = (globalThis as any)._$HY;
    hy.r["sc:live"] = live;
    const container = mountShell(P_BEFORE + frameHtml(fid));
    const before = snapshotNodes(container, fid);
    const warnings = captureWarnings();
    vi.stubGlobal("fetch", () => {
      throw new Error("fetch must not be called");
    });
    const gated = makeGatedHost();
    // Count the slot applies the boundary routes into the store, by key.
    const applied: Record<string, number> = {};
    const origApply = gated.host.apply.bind(gated.host);
    gated.host.apply = (chunk: any) => {
      if (chunk.type === "slot") applied[chunk.key] = (applied[chunk.key] ?? 0) + 1;
      return origApply(chunk);
    };
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
    expect(mounts.note).toEqual(["n1", "n2"]);
    expect(mounts.comment).toEqual([]);
    const drained = { ...applied };
    expect(drained["comment#c1"]).toBe(1);
    expect(drained["comment#c2"]).toBe(1);

    // A reveal elsewhere in the page: the boundary re-drains. Nothing new
    // for it, so nothing re-applies.
    ledger.reveal(container);
    flush();
    expect(applied).toEqual(drained);

    // A later data script lands a new key, and a reveal drains it: only
    // the new key applies (it names no occurrence in the markup; it just
    // sits in the store).
    hy.r[`sc:slot:${fid}:comment#c9`] = { cid: "c9" };
    ledger.reveal(container);
    flush();
    expect(applied["comment#c9"]).toBe(1);
    expect(applied["comment#c1"]).toBe(1);
    expect(applied["comment#c2"]).toBe(1);

    // The live channel re-sends `comment#c1` with the same marker (the
    // producer's end-of-stream flush does this on every page). Another
    // store write — equal args — while the occurrence is still held.
    const record = hy.r[`sc:slot:${fid}:comment#c1`];
    liveController.enqueue({ type: "slot", fid, key: "comment#c1", args: { ...record } });
    liveController.close();
    await sleep(10);
    flush();
    expect(applied["comment#c1"]).toBe(2);
    expect(mounts.comment).toEqual([]);
    expect(container.querySelector(`[_hk="sc-${fid}-comment#c1-0"]`)).toBe(before.c1);

    // Release: each held occurrence mounts exactly once, from its record.
    await gated.release();
    await sleep(10);
    flush();
    expect(mounts.comment).toEqual(["c1", "c2"]);
    expectClaimed(container, before, fid);
    expect(before.c1name.textContent).toBe("Ada");
    expect(before.c2name.textContent).toBe("Grace");
    // Settled: no further writes, no second mount.
    await sleep(10);
    flush();
    expect(mounts.comment).toEqual(["c1", "c2"]);
    expect(warnings).toEqual([]);
    dispose();
    container.remove();
  });
});
