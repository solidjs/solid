/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * The lazy materializer's HOLD outlives the hydration pass: the frame holds
 * a trace-carrying occurrence (server interior on screen) while the chunk
 * loads, and nothing keeps `hydrate()` open for it — the root pass ends,
 * `onHydrationEnd` fires, `_$HY.done` latches. The load settles AFTER all of
 * that. The late mount must still be a CLAIM of the server markup (the
 * frames' scoped re-entry, `claimRender`), never a fresh render beside it,
 * and the fill must be live: the materialized store readable, handlers
 * bound, the claimed sibling after the frame hydrated as normal.
 *
 * The load is a test-owned promise (`makeGatedHost`): the production host's
 * `prepareArgs` returns the real chunk import, which the welcome-status-lazy
 * spec pins; this spec pins the ORDERING against hydration end.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { createSignal, flush } from "solid-js";
import { sharedConfig } from "solid-js/internal";
import { hydrate } from "@solidjs/web";
import { installServerComponents } from "../../frames/src/client.js";
import {
  After,
  captureWarnings,
  cleanupHold,
  commentFill,
  expectClaimed,
  FID,
  installRecords,
  makeGatedHost,
  mounts,
  mountShell,
  noteFill,
  sleep,
  snapshotNodes,
  traceState
} from "./container-trace-hold-helpers.jsx";

describe("container-trace hold vs hydration end", () => {
  afterEach(cleanupHold);

  test("hydration completes while the load pends; the late mount claims the server markup", async () => {
    installRecords();
    const container = mountShell();
    const before = snapshotNodes(container);
    const warnings = captureWarnings();
    vi.stubGlobal("fetch", () => {
      throw new Error("fetch must not be called");
    });
    expect(traceState()?.materializeTrace).toBeUndefined();
    const gated = makeGatedHost();
    installServerComponents(gated.host);

    const [label, setLabel] = createSignal("after");
    const Thread = (globalThis as any)._$SC.r(FID);
    const dispose = hydrate(
      () => (
        <>
          <After text={label()} />
          <Thread comment={commentFill} note={noteFill} />
        </>
      ),
      container
    );
    flush();

    // The root pass is over and nothing is pending: hydration is DONE from
    // solid's point of view while the two trace-carrying occurrences are
    // still held (the ordinary fills claimed in the pass).
    expect(gated.state.asks).toBeGreaterThan(0);
    expect(mounts.note).toEqual(["n1", "n2"]);
    expect(mounts.comment).toEqual([]);
    expect(sharedConfig.hydrating).toBe(false);
    expect(sharedConfig.isHydrationInProgress!()).toBe(false);
    let ended = false;
    sharedConfig.onHydrationEnd!(() => (ended = true));
    await Promise.resolve();
    expect(ended).toBe(true);
    // The completion timeout ran too: the document flag latched and the
    // dev sweep reported nothing — held fills are a frame's business.
    await sleep(0);
    expect((globalThis as any)._$HY.done).toBe(true);
    expect(sharedConfig.done).toBe(true);
    expect(warnings).toEqual([]);
    // Still held: server interior untouched, store not materialized.
    expect(mounts.comment).toEqual([]);
    expect(container.querySelector(`[_hk="sc-${FID}-comment#c1-0"]`)).toBe(before.c1);
    expect(traceState()?.materializeTrace).toBeUndefined();

    // The load settles — after hydration end, after `_$HY.done`.
    await gated.release();
    await sleep(10);
    flush();

    // Mounted once each, as CLAIMS: every server node is still the node.
    expect(mounts.comment).toEqual(["c1", "c2"]);
    expect(mounts.note).toEqual(["n1", "n2"]);
    expectClaimed(container, before);
    expect(warnings).toEqual([]);

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
