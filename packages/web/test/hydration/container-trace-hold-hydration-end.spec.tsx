/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * The traces tier's HOLD and hydration end — RE-PINNED under frames-rulings
 * 3.1 (ruled 2026-10-05): hydration WAITS for the load; the mount claims
 * BEFORE done.
 *
 * The frame holds a trace-carrying occurrence (server interior on screen)
 * while the tier's chunk loads. The hold is one more reason in the frame's
 * registered hold (3.2 — one `initBoundaryResume` registration per frame
 * while a sync leaves an adopt-time occurrence waiting), so from solid's
 * point of view hydration is still in progress: the root pass is over, but
 * a pending boundary stands. `onHydrationEnd` does not fire, `_$HY.done`
 * does not latch. The load settles, the late mount CLAIMS the server markup
 * (the frames' scoped re-entry, `claimRender` — never a fresh render beside
 * it), the hold releases, and only then is hydration done; the fill is
 * live: the materialized store readable, handlers bound, the claimed
 * sibling after the frame hydrated as normal.
 *
 * S1's original pin (`9927ddddd`) asserted the opposite order — done
 * before the claim, the hold "a frame's business" — the private notion of
 * done 3.1 rejects; the claim assertions are kept, the order inverted
 * (3.1 "Consequences"; the plan's §3 row C3 and §5).
 *
 * The load is the test's (`gateTraceTier`); the production loader's path
 * is `welcome-status-lazy.spec`. This spec pins the ORDERING against
 * hydration end.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { createSignal, flush } from "solid-js";
import { sharedConfig } from "solid-js/internal";
import { hydrate } from "@solidjs/web";
import {
  After,
  captureWarnings,
  cleanupHold,
  commentFill,
  expectClaimed,
  FID,
  gateTraceTier,
  installRecords,
  mounts,
  mountShell,
  noteFill,
  sleep,
  snapshotNodes,
  traceTierResident
} from "./container-trace-hold-helpers.jsx";

describe("container-trace hold vs hydration end (frames-rulings 3.1)", () => {
  afterEach(cleanupHold);

  test("hydration waits for the load; the late mount claims the server markup before done", async () => {
    installRecords();
    const container = mountShell();
    const before = snapshotNodes(container);
    const warnings = captureWarnings();
    vi.stubGlobal("fetch", () => {
      throw new Error("fetch must not be called");
    });
    const gated = gateTraceTier();
    expect(traceTierResident()).toBe(false);

    const [label, setLabel] = createSignal("after");
    const Thread = (globalThis as any)._$SC.r(FID);
    let mountsAtEnd = -1;
    let inProgressAtEnd: boolean | undefined;
    const dispose = hydrate(
      () => (
        <>
          <After text={label()} />
          <Thread comment={commentFill} note={noteFill} />
        </>
      ),
      container
    );
    sharedConfig.onHydrationEnd!(() => {
      mountsAtEnd = mounts.comment.length;
      inProgressAtEnd = sharedConfig.isHydrationInProgress!();
    });
    flush();

    // The root pass is over; the ordinary fills claimed in it; the two
    // trace-carrying occurrences are HELD on the tier's load — asked once.
    expect(gated.loader).toHaveBeenCalledTimes(1);
    expect(mounts.note).toEqual(["n1", "n2"]);
    expect(mounts.comment).toEqual([]);
    expect(sharedConfig.hydrating).toBe(false);
    // 3.1: the hold is a pending boundary — hydration is NOT done.
    expect(sharedConfig.isHydrationInProgress!()).toBe(true);
    await sleep(0);
    flush();
    expect(sharedConfig.isHydrationInProgress!()).toBe(true);
    expect(mountsAtEnd).toBe(-1);
    expect((globalThis as any)._$HY.done).toBeUndefined();
    expect(warnings).toEqual([]);
    // Still held: server interior untouched, the tier not resident.
    expect(mounts.comment).toEqual([]);
    expect(container.querySelector(`[_hk="sc-${FID}-comment#c1-0"]`)).toBe(before.c1);
    expect(traceTierResident()).toBe(false);

    // The load settles: the install, one flush per live frame, the mounts.
    await gated.release();
    await sleep(10);
    flush();

    // Mounted once each, as CLAIMS: every server node is still the node.
    expect(traceTierResident()).toBe(true);
    expect(mounts.comment).toEqual(["c1", "c2"]);
    expect(mounts.note).toEqual(["n1", "n2"]);
    expectClaimed(container, before);
    expect(warnings).toEqual([]);

    // The order 3.2 pins: the claims, then the hold's release, then done.
    // At the end callback both fills had mounted; done came after them.
    expect(mountsAtEnd).toBe(2);
    expect(inProgressAtEnd).toBe(false);
    expect(sharedConfig.isHydrationInProgress!()).toBe(false);
    expect(sharedConfig.done).toBe(true);
    expect((globalThis as any)._$HY.done).toBe(true);

    // The materialized stores read (snapshot replayed from the stream).
    expect(before.c1name.textContent).toBe("Ada");
    expect(before.c2name.textContent).toBe("Grace");

    // Interactive: the claimed buttons' handlers are bound; the claimed
    // sibling beside the frame is live.
    const buttons = container.querySelectorAll("button");
    expect(buttons.length).toBe(2);
    buttons[0].click();
    flush();
    buttons[1].click();
    flush();
    buttons[1].click();
    flush();
    expect(buttons[0].textContent).toBe("1");
    expect(buttons[1].textContent).toBe("2");
    setLabel("later");
    flush();
    expect(before.before.textContent).toBe("later");

    dispose();
    container.remove();
  });
});
