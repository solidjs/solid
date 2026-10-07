/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * Snapshot consistency across the hold. A trace is a seroval stream whose
 * `.on()` replays its buffer synchronously at subscribe, so the store a late
 * materialization builds is the fold of EVERYTHING the document delivered
 * so far — the snapshot and every patch that landed while the load was
 * pending — exactly the state a resident materializer would hold at the
 * same point. Patches after that are live emissions either way.
 *
 * On SCREEN the two must agree too. The claim pass trusts the server's
 * markup (a text hole is never rewritten during a claim), and the markup
 * shows the SNAPSHOT — so the materializer, told it is read for a CLAIM
 * (`revive(value, claiming)` from the adopt-time mount, frames-rulings 3.6
 * (iii)), applies the snapshot at once and parks a replayed backlog beyond
 * it until hydration ends, where the fill's reads re-run outside hydration
 * and the DOM catches up (the store-shaped async-iterable hydration does the
 * same with its buffered backlog). Both the late claim (under the tier's
 * hold — the park releases after the hold, 3.2's order) and the resident
 * t=0 claim go through that, so a trace past the markup renders its current
 * state in either run.
 *
 * Two timelines, each run lazy (held) and resident, store state compared:
 *  - "during": snapshot before hydrate; patches arrive during the wait
 *    (resident: the same beats after its t=0 mount) — a live update there;
 *  - "ahead": snapshot AND patches already delivered before hydrate (the
 *    trace moved past the markup before the client booted).
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { createSignal, flush } from "solid-js";
import { materializeContainerTrace } from "solid-js/internal/container-trace";
import { hydrate } from "@solidjs/web";
import { createStream } from "seroval";
import {
  After,
  captureWarnings,
  cleanupHold,
  commentFill,
  expectClaimed,
  fakeLedger,
  FID,
  frameHtml,
  gateTraceTier,
  installRecords,
  mounts,
  mountShell,
  noteFill,
  P_BEFORE,
  residentTraceTier,
  sleep,
  snapshotNodes,
  type Streams
} from "./container-trace-hold-helpers.jsx";

describe("container-trace hold: snapshot consistency", () => {
  afterEach(cleanupHold);

  let n = 0;
  async function run(
    mode: "lazy" | "resident",
    emit: (s: Streams) => void,
    duringWait: (s: Streams) => void
  ) {
    const fid = `${FID}/snap-${mode}${++n}`;
    const ledger = fakeLedger();
    const streams = installRecords({ fid, emit, hy: { fr: ledger.ledger } });
    const container = mountShell(P_BEFORE + frameHtml(fid));
    const before = snapshotNodes(container, fid);
    const warnings = captureWarnings();
    vi.stubGlobal("fetch", () => {
      throw new Error("fetch must not be called");
    });
    const gated = mode === "lazy" ? gateTraceTier() : undefined;
    if (!gated) await residentTraceTier();
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
    if (gated) expect(mounts.comment).toEqual([]);
    else expect(mounts.comment).toEqual(["c1", "c2"]);
    // The wait: emissions land in the stream's buffer (lazy: nothing has
    // subscribed yet; resident: the live store folds them as they come).
    duringWait(streams);
    flush();
    if (gated) {
      await gated.release();
    }
    await sleep(10);
    flush();
    expect(mounts.comment).toEqual(["c1", "c2"]);
    expectClaimed(container, before, fid);
    const store = mounts.stores[0];
    return { fid, container, before, warnings, dispose, store, streams };
  }

  const snapshotOnly = (s: Streams) => {
    s.c1.next({ name: "Ada", edits: 0 });
    s.c2.next({ name: "Grace" });
    s.c2.return(undefined);
  };
  const twoPatches = (s: Streams) => {
    s.c1.next([[["edits"], 1]]);
    s.c1.next([
      [["name"], "Ada (edited)"],
      [["edits"], 2]
    ]);
  };

  test("patches arriving during the wait replay fully: the late store equals the resident one", async () => {
    const lazy = await run("lazy", snapshotOnly, twoPatches);
    expect(lazy.store.name).toBe("Ada (edited)");
    expect(lazy.store.edits).toBe(2);
    expect(lazy.before.c1name.textContent).toBe("Ada (edited)");
    expect(lazy.warnings).toEqual([]);
    // A patch after the mount is a live update on the same store.
    lazy.streams.c1.next([[["name"], "Ada (live)"]]);
    flush();
    expect(lazy.store.name).toBe("Ada (live)");
    expect(lazy.before.c1name.textContent).toBe("Ada (live)");
    lazy.dispose();
    cleanupHold();

    const resident = await run("resident", snapshotOnly, twoPatches);
    expect(resident.store.name).toBe("Ada (edited)");
    expect(resident.store.edits).toBe(2);
    expect(resident.before.c1name.textContent).toBe("Ada (edited)");
    expect(resident.warnings).toEqual([]);
    resident.dispose();
  });

  test("a trace already past the markup: the late store is the fold of all of it", async () => {
    const ahead = (s: Streams) => {
      snapshotOnly(s);
      twoPatches(s);
      s.c1.return(undefined);
    };
    const lazy = await run("lazy", ahead, () => {});
    expect(lazy.store.name).toBe("Ada (edited)");
    expect(lazy.store.edits).toBe(2);
    // Mounted under the hold as a CLAIM: the fill read the snapshot ("Ada",
    // the markup's text), the park released after the hold (3.2's order)
    // and the hole caught up.
    expect(lazy.before.c1name.textContent).toBe("Ada (edited)");
    expect(lazy.warnings).toEqual([]);
    lazy.dispose();
    cleanupHold();

    const resident = await run("resident", ahead, () => {});
    expect(resident.store.name).toBe("Ada (edited)");
    expect(resident.store.edits).toBe(2);
    // The resident t=0 claim ran against markup showing "Ada"; the parked
    // backlog applied at hydration end and the hole caught up.
    expect(resident.before.c1name.textContent).toBe("Ada (edited)");
    expect(resident.warnings).toEqual([]);
    resident.dispose();
  });

  // The seam itself: only a CLAIM parks (keyed on the claim since the traces
  // tier — plan step C3; frames-rulings 3.6 "Landed"). A trace materialized
  // for a fresh mount (no server markup to agree with) is the fold of its
  // whole backlog at once, no beat paid; one materialized for a claim
  // outside the document's pass (a frame's late claim) shows the snapshot
  // and folds on the next microtask.
  test("the backlog parks for a claim only", async () => {
    const ahead = () => {
      const s = createStream();
      s.next({ name: "Ada", edits: 0 });
      s.next([[["edits"], 1]]);
      s.next([
        [["name"], "Ada (edited)"],
        [["edits"], 2]
      ]);
      return s;
    };
    const fresh = materializeContainerTrace({ $tr: ahead() as any });
    expect(fresh.name).toBe("Ada (edited)");
    expect(fresh.edits).toBe(2);

    const claimed = materializeContainerTrace({ $tr: ahead() as any }, true);
    expect(claimed.name).toBe("Ada");
    expect(claimed.edits).toBe(0);
    await sleep(0);
    flush();
    expect(claimed.name).toBe("Ada (edited)");
    expect(claimed.edits).toBe(2);
  });
});
