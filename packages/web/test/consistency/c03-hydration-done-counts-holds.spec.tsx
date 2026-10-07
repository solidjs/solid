/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * C3 — hydration-done counts every hold.
 *
 * "When hydration reports done (`onHydrationEnd` fires, `_$HY.done`), every
 * occurrence in adopted content has claimed, or the hold deferring it is
 * counted so that done waits for it."
 *
 * Mechanism meant to carry it: solid/src/client/hydration.ts
 * `checkHydrationComplete` / `_pendingBoundaries` (what done waits on) vs
 * frames/src/frame-client.ts `#syncSlots`' deferrals — the #2968 record
 * defer (`#recordRefresh`), the `{$ref}` wait (`#refsUnresolved`) — none of
 * which registers with the counter.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { hydrate } from "@solidjs/web";
import {
  bootPage,
  fillHtml,
  frameHtml,
  freshFid,
  hydrationInProgress,
  onHydrationEnd,
  quiesce,
  slotRange,
  traceMarker,
  type Page
} from "./support.js";

let page: Page | undefined;
afterEach(async () => {
  await page?.cleanup();
  page = undefined;
});

describe("C3 — hydration-done counts every hold", () => {
  // Arm (a): the #2968 record defer. The parser is still running when the
  // boundary adopts (document.readyState "loading"), and the occurrence's
  // args record has not executed yet — the frame defers the mount. Hydration
  // must not report done while that occurrence's server nodes are unclaimed.
  // Was red on `next` (the deferral registered with nothing hydration
  // counts); green under frames-rulings 3.1 (ruled) / 3.2: the frame's hold
  // is a pending boundary — registered through `sharedConfig.holdBoundary`
  // while a sync leaves an adopted occurrence waiting, released by the sync
  // that claims it.
  test("(a) record defer: hydration does not report done while an adopted occurrence waits on its record", async () => {
    const fid = freshFid("c3a");
    vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
    page = bootPage(
      frameHtml(fid, `<ul>${slotRange("item#0", fillHtml(fid, "item#0", "one"))}</ul>`)
    );
    // Declared at the marker (S-record), settled by the script the parser
    // is still owed.
    const record = page.declareSlotRecord(fid, "item#0");
    const Comp = (globalThis as any)._$SC.r(fid);
    const invocations: number[] = [];
    let invocationsAtEnd = -1;
    let inProgressAtEnd: boolean | undefined;
    const dispose = hydrate(
      () => (
        <Comp
          item={(p: { text: string }) => {
            invocations.push(1);
            return <li>{p.text}</li>;
          }}
        />
      ),
      page.container
    );
    onHydrationEnd(() => {
      invocationsAtEnd = invocations.length;
      inProgressAtEnd = hydrationInProgress();
    });
    await quiesce();
    // The record's settle script the parser was still owed.
    record.settle({ text: "one" });
    await quiesce();
    await quiesce();
    // The occurrence did claim in the end (the deferral is invisible)…
    expect(invocations.length).toBe(1);
    expect(page.container.textContent).toBe("one");
    // …and hydration-done waited for it: at the end callback the fill had
    // run (on `next` invocationsAtEnd was 0 — done ran ahead, nothing
    // counted the hold).
    expect(page.warnings.filter(w => w.includes("unclaimed server-rendered"))).toEqual([]);
    expect(inProgressAtEnd).toBe(false);
    expect(invocationsAtEnd).toBe(1);
    dispose();
  });

  // Arm (b): a container-trace arg present at adoption. The record and its
  // trace snapshot are in the page when the boundary adopts; the fill reads
  // `props.data.n` through the revived projection. Since the traces tier
  // (plan step C3) the materializer loads LAZILY (`@solidjs/web/frames/
  // trace`, through `prepareTier("trace")`), so the adopt pass finds it
  // absent and HOLDS the occurrence — S1's `prepareArgs` hold, re-based onto
  // A2's registered held set: the hold is a pending boundary (3.1), so done
  // waits for the late claim. This is S1's C3 (b) arm, green by the ruling
  // (it was the probe that would have been red on S1 as built, where the
  // hold registered with nothing hydration counted).
  test("(b) container-trace arg present at adoption: the occurrence has claimed by hydration end", async () => {
    const fid = freshFid("c3b");
    page = bootPage(
      frameHtml(fid, `<ul>${slotRange("item#0", fillHtml(fid, "item#0", "1"))}</ul>`)
    );
    const trace = traceMarker();
    trace.snapshot({ n: 1 });
    page.slotRecord(fid, "item#0", { data: trace.marker });
    const Comp = (globalThis as any)._$SC.r(fid);
    const invocations: number[] = [];
    let invocationsAtEnd = -1;
    const dispose = hydrate(
      () => (
        <Comp
          item={(p: { data: { n: number } }) => {
            invocations.push(1);
            return <li>{p.data.n}</li>;
          }}
        />
      ),
      page.container
    );
    onHydrationEnd(() => {
      invocationsAtEnd = invocations.length;
    });
    // The adopt pass HELD the occurrence on its tier: no fill yet, the
    // server's interior on screen, hydration not done (the hold counts).
    expect(invocations.length).toBe(0);
    expect(page.container.textContent).toBe("1");
    expect(hydrationInProgress()).toBe(true);
    await quiesce();
    await quiesce();
    expect(invocations.length).toBe(1);
    expect(page.container.textContent).toBe("1");
    expect(page.warnings).toEqual([]);
    // A later patch reaches the claimed fill.
    trace.patch([[["n"], 2]]);
    await quiesce();
    expect(page.container.textContent).toBe("2");
    expect(invocationsAtEnd).toBe(1);
    dispose();
  });

  // Control: when the record is present at adoption, done implies claimed —
  // the occurrence mounts in the hydrate pass itself.
  test("(control) record present at adoption: the occurrence has claimed by hydration end", async () => {
    const fid = freshFid("c3c");
    page = bootPage(
      frameHtml(fid, `<ul>${slotRange("item#0", fillHtml(fid, "item#0", "one"))}</ul>`)
    );
    page.slotRecord(fid, "item#0", { text: "one" });
    const Comp = (globalThis as any)._$SC.r(fid);
    const invocations: number[] = [];
    let invocationsAtEnd = -1;
    const dispose = hydrate(
      () => (
        <Comp
          item={(p: { text: string }) => {
            invocations.push(1);
            return <li>{p.text}</li>;
          }}
        />
      ),
      page.container
    );
    onHydrationEnd(() => {
      invocationsAtEnd = invocations.length;
    });
    await quiesce();
    await quiesce();
    expect(invocations.length).toBe(1);
    expect(invocationsAtEnd).toBe(1);
    expect(page.container.textContent).toBe("one");
    expect(page.warnings).toEqual([]);
    dispose();
  });
});
