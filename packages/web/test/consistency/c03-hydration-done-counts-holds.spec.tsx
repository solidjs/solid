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
  test.fails(
    "(a) record defer: hydration does not report done while an adopted occurrence waits on its record",
    async () => {
      const fid = freshFid("c3a");
      vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
      page = bootPage(
        frameHtml(fid, `<ul>${slotRange("item#0", fillHtml(fid, "item#0", "one"))}</ul>`)
      );
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
      // The record script the parser was still owed.
      page.slotRecord(fid, "item#0", { text: "one" });
      await quiesce();
      await quiesce();
      // The occurrence did claim in the end (the deferral is invisible)…
      expect(invocations.length).toBe(1);
      expect(page.container.textContent).toBe("one");
      // …but hydration-done ran ahead of it: at the end callback the fill had
      // not run, `isHydrationInProgress()` already read false, and nothing
      // counted the hold (`_pendingBoundaries` only knows <Loading>
      // boundaries). Observed on `next`: invocationsAtEnd === 0 (expected 1).
      // The dev completion check stays quiet here only because the deferred
      // claim lands before its timer reads the registry.
      expect(page.warnings.filter(w => w.includes("unclaimed server-rendered"))).toEqual([]);
      expect(inProgressAtEnd).toBe(false);
      expect(invocationsAtEnd).toBe(1);
      dispose();
    }
  );

  // Arm (b): a container-trace arg present at adoption. The record and its
  // trace snapshot are in the page when the boundary adopts; the fill reads
  // `props.data.n` through the revived projection. On `next` the materializer
  // is installed at module load, so the claim runs in the adopt pass and done
  // implies claimed. (On `size/s1-lazy-store-materializer` the materializer
  // loads lazily and `prepareArgs` HOLDS the occurrence until it lands — a
  // hold hydration does not count; this arm is the S1 probe.)
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
