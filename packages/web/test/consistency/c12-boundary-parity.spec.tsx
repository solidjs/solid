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
  // an error. Re-read under A0 (frames-rulings 3.3, corollary 4 inward):
  // the server `<Loading>` inside the frame is the SERVER's boundary, and
  // the client shows whatever the server rendered for its outcome — never
  // a blank, never a client-invented error fallback. Two halves: the
  // client reports the rejection in dev (c1, green); the position shows
  // the server's rendered outcome (c2) — red until the server half renders
  // the error outcome into the fragment instead of a blank (the fix is
  // `server.ts`'s, not a client state).
  test("(c1) rejected after adopt: the rejection is reported in dev; the client invents no error state", async () => {
    const fid = freshFid("c12c1");
    const frag = "c12c1-frag";
    page = bootPage(shell(fid, frag));
    const fetches = countFetches();
    const fr = page.declareFragment(frag);
    const Comp = (globalThis as any)._$SC.r(fid);
    const dispose = hydrate(
      () => <Comp item={(p: { text: string }) => <li>{p.text}</li>} />,
      page.container
    );
    await quiesce();
    const swapped = page.revealFragment(frag, " ", false);
    fr.reject(new Error("boom"));
    await quiesce();
    await quiesce();
    expect(swapped).toBe(1);
    expect(fr.promise.s).toBe(2);
    expect(page.hy.fr.pending()).toBe(false);
    expect(fetches).toEqual([]);
    // Reported, once, naming the fragment and the frame.
    expect(page.errors.length).toBe(1);
    expect(page.errors[0]).toContain(`fragment "${frag}"`);
    expect(page.errors[0]).toContain(fid);
    expect(page.warnings).toEqual([]);
    // No client error state at the position: what the server wrote stands.
    expect(page.container.querySelector("li")).toBeNull();
    dispose();
  });

  // The server half (frames-rulings §"The server half" (iii), built): the
  // document face's error path renders the boundary's error outcome into the
  // fragment template — the nearest SERVER `<Errored>`'s fallback at the
  // `<Loading>`'s position (test/server/frame-fragment-error-outcome.spec.tsx
  // pins the sink on both faces) — and `_fr` rejects as the diagnostic. The
  // page below carries that output: the template is the Errored's fallback,
  // not the `" "` the server used to write. The client shows it and invents
  // nothing (c1).
  test("(c2) rejected after adopt: the position shows the server's rendered outcome — the server <Errored>'s fallback — never a blank", async () => {
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

    // The rejected fragment's chunk as the server now writes it: the
    // Errored's fallback as the template + `$df`, then the `_fr` rejection.
    const swapped = page.revealFragment(frag, '<em class="fail">failed: boom</em>', false);
    fr.reject(new Error("boom"));
    await quiesce();
    await quiesce();
    frames.sample();
    expect(swapped).toBe(1);
    expect(fr.promise.s).toBe(2);
    expect(page.hy.fr.pending()).toBe(false);
    expect(fetches).toEqual([]);
    // The server's outcome at the position, in one visible transition.
    expect(frames.frames).toEqual(["loading", "failed: boom"]);
    expect(page.container.querySelector("em.fail")).not.toBeNull();
    expect(page.container.querySelector("i")).toBeNull();
    // Reported once in dev (c1); no client error state.
    expect(page.errors.length).toBe(1);
    expect(page.errors[0]).toContain(`fragment "${frag}"`);
    expect(page.container.querySelector("li")).toBeNull();
    frames.stop();
    dispose();
  });

  // The escape arm: no server `<Errored>` encloses the boundary. The server
  // keeps the boundary's own markup at the position (its fallback — never a
  // blank) and the error escapes the component: the frame as one async
  // value errored, carried on the document face as an `sc:live` error op
  // addressed to the frame (`fid`), which only the owning boundary applies
  // — the frame's `:error` (the outward face; what the client does with it
  // beyond recording it is the client's — today `frame.error`).
  test("(c3) rejected after adopt, no server <Errored>: the position keeps the fallback and the frame records the escaped error", async () => {
    const fid = freshFid("c12c3");
    const other = freshFid("c12c3-other");
    const frag = "c12c3-frag";
    page = bootPage(shell(fid, frag) + frameHtml(other, "<p>other</p>"));
    const fetches = countFetches();
    const fr = page.declareFragment(frag);
    const Comp = (globalThis as any)._$SC.r(fid);
    const Other = (globalThis as any)._$SC.r(other);
    const frames = watchFrames(page.container);
    const dispose = hydrate(
      () => (
        <>
          <Comp item={(p: { text: string }) => <li>{p.text}</li>} />
          <Other />
        </>
      ),
      page.container
    );
    await quiesce();
    expect(frames.frames).toEqual(["loadingother"]);

    const swapped = page.revealFragment(frag, "<i>loading</i>", false);
    fr.reject(new Error("boom"));
    page.live.push({ type: "error", fid, error: "boom" });
    await quiesce();
    await quiesce();
    frames.sample();
    expect(swapped).toBe(1);
    expect(fr.promise.s).toBe(2);
    expect(fetches).toEqual([]);
    // The position never blanked: the fallback stands.
    expect(frames.frames).toEqual(["loadingother"]);
    // The escaped error is the frame's — this frame's, not its neighbour's.
    expect((page.host.get(fid) as any).error).toBe("boom");
    expect((page.host.get(other) as any).error).toBeUndefined();
    expect(page.errors.length).toBe(1);
    frames.stop();
    dispose();
  });
});
