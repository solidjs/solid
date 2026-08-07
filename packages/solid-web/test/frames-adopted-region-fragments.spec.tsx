/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// Regression for #2978: a deferred fragment INSIDE an adopted server-component
// region deadlocks when it settles after hydration completes.
//
// The wedge is a standoff between two policies that are each correct alone:
//
// - The held-swap policy (#2964): a `$df` arriving post-done with no claimant
//   on record is HELD — placeholder, fallback and template left intact — until
//   a boundary claims the fragment and replays it.
// - The frames classification gate (#2968): an adopted occurrence without a
//   record DEFERS while `_$HY.fr.pending()` is true, because a held fragment's
//   replay can still deliver its record.
//
// But a `<Loading>` that suspended inside a SERVER component during document
// SSR has no client-side boundary AT ALL — the component never runs on the
// client, so nothing ever registers as the fragment's claimant. The swap is
// held forever, `fr.pending()` never flips false, and every consumer of that
// answer (slot classification, late-boundary waiters) waits on a delivery
// that already arrived.
//
// The adoption is the claimant of record for everything inside the markup it
// adopted: `adoptBoundary` now claims each `pl-*` placeholder in its region
// (and in content revealed into it later), so the post-done swap proceeds and
// the ledger entry resolves.
//
// The boundary element index is a once-per-boot module cache (first lookup
// scans the document), so both tests' boundaries are seeded into ONE document
// up front and each test adopts its own fid.
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { createRoot, enableHydration, flush, Loading } from "solid-js";
import { hydrate } from "@solidjs/web";
import { installServerComponents, createFrameHost } from "../frames/src/client.js";
import { createJSONDataTable } from "../serialization/src/index.js";

const settle = () => new Promise(r => setTimeout(r));

function makeHost() {
  const table = createJSONDataTable();
  return createFrameHost({
    applyData: (c: any) => table.apply(c),
    resolve: (r: any) => table.resolve(r)
  });
}

/** A pending `<id>_fr` declaration as the serializer writes it: an unsettled
 *  promise ref — the ledger reads `.s` for settlement, never awaits it. */
function declareFragment(id: string) {
  (window as any)._$HY.r[`${id}_fr`] = { then() {} };
}

/** The inline runtime's raw swap, faithful to $dfr in REPLACE_SCRIPT: remove
 *  the fallback between `template#pl-<id>` and the `<!--pl-<id>-->` end
 *  comment, replace the comment with `template#<id>`'s content, record the
 *  reveal (`_$HY.v`), announce it (`_$HY.fe`). */
function installSwapRuntime() {
  (globalThis as any).$dfr = (e: string) => {
    const n = document.getElementById(e) as HTMLTemplateElement | null;
    if (!n) return 0;
    let o: ChildNode | null = document.getElementById("pl-" + e);
    if (!o) return 0;
    while (o && !(o.nodeType === 8 && o.nodeValue === "pl-" + e)) {
      const t = o.nextSibling;
      o.remove();
      o = t;
    }
    const parent = o!.parentNode;
    (o as ChildNode).replaceWith(n.content);
    n.remove();
    const hy = (window as any)._$HY;
    (hy.v = hy.v || {})[e] = 1;
    hy.fe(e, parent);
    return 1;
  };
}

/** The stream's `$df(id)` route: through the policy when installed. */
function $df(id: string) {
  const hy = (window as any)._$HY;
  return hy.f ? hy.f(id) : (globalThis as any).$dfr(id);
}

/** The chunk that delivers fragment `id`: content template appended at the
 *  stream position (document end), the seroval write that settles the `_fr`
 *  ref, and the `$df` swap call — all in one batch, as the server emits them. */
function deliverFragment(id: string, html: string) {
  const tpl = document.createElement("template");
  tpl.id = id;
  tpl.innerHTML = html;
  document.body.appendChild(tpl);
  const ref = (window as any)._$HY.r[`${id}_fr`];
  if (ref) ref.s = 1;
  $df(id);
}

/** Latch global hydration done, the way a completed root pass does. */
function completeHydrationPass() {
  const other = document.createElement("div");
  document.body.appendChild(other);
  hydrate(() => null, other)();
  flush();
  other.remove();
}

/** An SSR'd server-component boundary whose inner <Loading> is still pending:
 *  placeholder, fallback, end comment — the shell as the document carries it. */
function boundaryHtml(fid: string, plId: string, fallbackText: string) {
  return (
    `<dx-frame data-fid="${fid}" style="display:contents">` +
    "<h1>Page</h1>" +
    `<template id="pl-${plId}"></template><span>${fallbackText}</span><!--pl-${plId}-->` +
    "</dx-frame>"
  );
}

function mountBoundary(fid: string) {
  const Page = (window as any)._$SC.r(fid);
  const appEl = document.getElementById("app") as HTMLElement;
  let mount!: HTMLDivElement;
  const dispose = createRoot(d => {
    <div ref={mount}>
      <Loading fallback={<span>shell-fallback</span>}>
        <Page />
      </Loading>
    </div>;
    appEl.appendChild(mount);
    return d;
  });
  return { mount, dispose };
}

describe("deferred fragments inside an adopted region (#2978)", () => {
  beforeAll(() => {
    // The whole page, before any boundary lookup: one SSR'd boundary per test.
    document.body.innerHTML =
      '<div id="app">' +
      boundaryHtml("deadlock/page", "11", "loading-fallback") +
      boundaryHtml("deadlock/nested", "21", "outer-fallback") +
      boundaryHtml("deadlock/replaced", "31", "replaced-fallback") +
      "</div>";
    (window as any)._$HY = { r: {}, fe() {} };
    enableHydration();
    installSwapRuntime();
    vi.stubGlobal("fetch", () => {
      throw new Error("fetch must not be called at t=0");
    });
    installServerComponents(makeHost());
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    delete (window as any)._$HY;
    delete (window as any)._$SC;
    delete (globalThis as any).$dfr;
    document.body.innerHTML = "";
  });

  test("a post-done $df for a placeholder in adopted markup swaps through and resolves the ledger", async () => {
    declareFragment("11");

    // The placeholder mounts and adopts the SSR'd element in place.
    const { dispose } = mountBoundary("deadlock/page");
    flush();
    await settle();
    flush();

    const frameEl = document.querySelector('[data-fid="deadlock/page"]') as HTMLElement;
    expect(frameEl.textContent).toContain("loading-fallback");

    // Global hydration completes — the page is interactive, the fragment is
    // still in flight (the server's inner memo takes its time).
    completeHydrationPass();
    await settle();

    // The fragment arrives. Post-done, its only rightful owner is the
    // adoption that claimed the region — the swap must proceed, not hold.
    deliverFragment("11", "<section>settled-content</section>");
    flush();
    await settle();
    flush();

    expect(frameEl.textContent).toContain("settled-content");
    expect(frameEl.textContent).not.toContain("loading-fallback");
    // The wedge's second face: the ledger must resolve, or everything
    // downstream of `fr.pending()` (slot classification, boundary waiters)
    // waits forever on a delivery that already happened.
    expect((window as any)._$HY.fr.pending()).toBe(false);
    expect(document.getElementById("pl-11")).toBe(null);
    expect(document.getElementById("11")).toBe(null);

    dispose();
  });

  test("a fragment revealed into the region carries a NESTED placeholder; the cascade claims it too", async () => {
    declareFragment("21");

    const { dispose } = mountBoundary("deadlock/nested");
    flush();
    await settle();
    flush();

    completeHydrationPass();
    await settle();

    // Outer content arrives, itself carrying an inner pending region (nested
    // server async). Its `_fr` is declared in the same chunk.
    declareFragment("22");
    deliverFragment(
      "21",
      '<div>outer-content<template id="pl-22"></template><span>inner-fallback</span><!--pl-22--></div>'
    );
    flush();
    await settle();
    flush();

    const frameEl = document.querySelector('[data-fid="deadlock/nested"]') as HTMLElement;
    expect(frameEl.textContent).toContain("outer-content");
    expect(frameEl.textContent).toContain("inner-fallback");
    // Inner still in flight: the ledger stays honest about it.
    expect((window as any)._$HY.fr.pending()).toBe(true);

    // The inner fragment settles — its placeholder entered the region through
    // a reveal, not the original adopt-time sweep, so the claim must cascade.
    deliverFragment("22", "<em>inner-content</em>");
    flush();
    await settle();
    flush();

    expect(frameEl.textContent).toContain("inner-content");
    expect(frameEl.textContent).not.toContain("inner-fallback");
    expect((window as any)._$HY.fr.pending()).toBe(false);

    dispose();
  });

  // The secondary defect: a refetch that morphs over the region BEFORE the
  // document fragment delivers removes the `pl-*` placeholder — the swap has
  // nowhere to land, and the stale content template alone must not keep the
  // ledger reading "in flight" for the rest of the page's life.
  test("a fragment whose placeholder range was replaced resolves the ledger as undeliverable", async () => {
    declareFragment("31");

    const { dispose } = mountBoundary("deadlock/replaced");
    flush();
    await settle();
    flush();

    completeHydrationPass();
    await settle();

    // A navigation's stream morphs the region while the document fragment is
    // still in flight: the placeholder range goes with the old content.
    const frameEl = document.querySelector('[data-fid="deadlock/replaced"]') as HTMLElement;
    frameEl.innerHTML = "<h1>Page</h1><section>refetched-content</section>";

    // The document's delivery lands late, aimed at a range that no longer
    // exists. Nothing can ever swap it in.
    deliverFragment("31", "<section>stale-content</section>");
    flush();
    await settle();
    flush();

    expect(frameEl.textContent).toContain("refetched-content");
    expect(frameEl.textContent).not.toContain("stale-content");
    expect((window as any)._$HY.fr.pending()).toBe(false);

    dispose();
  });
});
