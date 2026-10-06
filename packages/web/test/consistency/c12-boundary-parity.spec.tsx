/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * C12 — boundary parity at claim.
 *
 * "A `<Loading>`/`<Errored>` boundary inside adopted content shows at claim
 * exactly what the shell shows at that position — content for a settled
 * fragment, the fallback for a pending one, the error fallback for a
 * rejected one — and changes only when the document (or a stream)
 * delivers."
 *
 * Mechanism meant to carry it: solid/src/client/hydration.ts
 * `hydratedCreateLoadingBoundary` (`_fr` states), `fragmentPolicy` (held
 * swaps), frames/src/client.ts `adoptBoundary.claimRegionFragments` (#2978:
 * the adoption goes on record as claimant of the server-produced `pl-*`
 * placeholders in its region so a late swap lands).
 *
 * Shape: a SERVER `<Loading>` inside the adopted frame — its producer ran
 * on the server, so there is no client boundary at this position; the
 * placeholder/fallback/`_fr` triple and the ledger are the whole mechanism.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { hydrate } from "@solidjs/web";
import {
  bootPage,
  fillHtml,
  frameHtml,
  freshFid,
  placeholderHtml,
  quiesce,
  slotRange,
  watchFrames,
  type Page
} from "./support.js";

let page: Page | undefined;
afterEach(async () => {
  await page?.cleanup();
  page = undefined;
});

const shell = (fid: string, frag: string) =>
  frameHtml(fid, `<ul>${placeholderHtml(frag, "<i>loading</i>")}</ul>`);

/** Replace the throwing fetch stub with a counting one (still answering nothing). */
function countFetches() {
  const calls: unknown[] = [];
  vi.stubGlobal("fetch", (...args: unknown[]) => {
    calls.push(args);
    return new Promise(() => {});
  });
  return calls;
}

describe("C12 — boundary parity at claim", () => {
  // Arm (a): pending at adoption. The shell shows the fallback; the claim
  // must show exactly that — no request, no fresh DOM, the ledger pending.
  test("(a) pending at adopt: the fallback shows, nothing is fetched, the ledger reads pending", async () => {
    const fid = freshFid("c12a");
    const frag = "c12a-frag";
    page = bootPage(shell(fid, frag));
    const fetches = countFetches();
    page.declareFragment(frag);
    const Comp = (globalThis as any)._$SC.r(fid);
    const fallback = page.container.querySelector("i")!;
    const frames = watchFrames(page.container);
    const invocations: number[] = [];
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
    await quiesce();
    await quiesce();
    frames.sample();
    expect(frames.frames).toEqual(["loading"]);
    expect(page.container.querySelector("i")).toBe(fallback);
    expect(invocations.length).toBe(0);
    expect(fetches).toEqual([]);
    expect(page.hy.fr.pending()).toBe(true);
    expect(page.warnings).toEqual([]);
    expect(page.errors).toEqual([]);
    frames.stop();
    dispose();
  });

  // Arm (b): revealed later. The document delivers the fragment (record,
  // then swap): content in, fallback out, the fills inside mount, the
  // ledger resolves — exactly one visible transition.
  test("(b) revealed after adopt: content replaces the fallback in one frame and the fills inside mount", async () => {
    const fid = freshFid("c12b");
    const frag = "c12b-frag";
    page = bootPage(shell(fid, frag));
    const fetches = countFetches();
    const fr = page.declareFragment(frag);
    const Comp = (globalThis as any)._$SC.r(fid);
    const frames = watchFrames(page.container);
    const invocations: number[] = [];
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
    await quiesce();
    expect(frames.frames).toEqual(["loading"]);

    page.slotRecord(fid, "item#0", { text: "one" });
    page.revealFragment(frag, slotRange("item#0", fillHtml(fid, "item#0", "one")));
    await quiesce();
    await quiesce();
    frames.sample();
    expect(fr.promise.s).toBe(1);
    expect(frames.frames).toEqual(["loading", "one"]);
    expect(page.container.querySelector("i")).toBeNull();
    expect(page.container.querySelector(`template#pl-${frag}`)).toBeNull();
    expect(invocations.length).toBe(1);
    expect(fetches).toEqual([]);
    expect(page.hy.fr.pending()).toBe(false);
    expect(page.warnings).toEqual([]);
    expect(page.errors).toEqual([]);
    frames.stop();
    dispose();
  });

  // Arm (c): rejected. The server's error path for a post-flush fragment
  // writes a blank content template (`sink.fragment(key, " ")`), activates
  // it (`$df`), and rejects `<key>_fr` (web/src/server.ts, the `done`
  // closure). The shell at that position is the fallback; the delivery is
  // an error. The invariant: the position shows the error fallback — fresh
  // client DOM — and never silently empties.
  test.fails(
    "(c) rejected after adopt: the position shows an error fallback, not a silent blank; the rejection is surfaced",
    async () => {
      const fid = freshFid("c12c");
      const frag = "c12c-frag";
      page = bootPage(shell(fid, frag));
      const fetches = countFetches();
      const fr = page.declareFragment(frag);
      const Comp = (globalThis as any)._$SC.r(fid);
      const frames = watchFrames(page.container);
      const dispose = hydrate(
        () => <Comp item={(p: { text: string }) => <li>{p.text}</li>} />,
        page.container
      );
      await quiesce();
      expect(frames.frames).toEqual(["loading"]);

      // The rejected fragment's chunk: blank template + `$df`, then the
      // `_fr` rejection.
      const swapped = page.revealFragment(frag, " ", false);
      fr.reject(new Error("boom"));
      await quiesce();
      await quiesce();
      frames.sample();
      expect(swapped).toBe(1);
      expect(fr.promise.s).toBe(2);
      expect(page.hy.fr.pending()).toBe(false);
      expect(fetches).toEqual([]);
      // Observed on next: the swap lands the blank template — the frame's
      // text goes "loading" → " " (the fallback is gone, the position is
      // empty), `fr.pending()` reads false, and NOTHING is logged: no
      // console.error, no warning, no diagnostics. Expected: an error
      // fallback at the position (fresh client DOM) and the rejection
      // surfaced. Where it goes wrong: the server `<Loading>` has no client
      // twin — solid/hydration.ts `hydratedCreateLoadingBoundary`'s `s === 2`
      // branch (resume fresh, error to the nearest <Errored>) only runs for
      // a boundary that registered against `<key>_fr`, and the adoption's
      // `claimRegionFragments` (client.ts adoptBoundary) only claims the
      // placeholder so the swap may proceed. The ledger's `fragmentPolicy`
      // then swaps whatever template the document wrote — here the blank —
      // and the `_fr` rejection has no consumer: `serovalPromise` (and the
      // real serializer's thenable) swallow it. The page converges on an
      // empty range with no record of the failure anywhere.
      expect(page.container.textContent.trim()).not.toBe("");
      expect(page.errors.length + page.warnings.length).toBeGreaterThan(0);
      frames.stop();
      dispose();
    }
  );
});
