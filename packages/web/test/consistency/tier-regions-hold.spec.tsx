/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * The regions tier's timing pin (frames savings pass §1, row "regions"; §3
 * row C4). The race: a `slot:` record naming a `{$frame}` ref — or a
 * `data-fid` region element inside adopted content — before
 * `@solidjs/web/frames/regions` has loaded. Lost, the fill would receive
 * the raw `{$frame}` ref (wrong content) and an occluded region could not
 * mount from the store. The bound: ANNOUNCE + HOLD / BUFFER.
 *
 *  - Document face, un-announced (the fallback): the adopt-time sync finds
 *    the record names a region (`needsRegions`), starts the load and HOLDS
 *    the occurrence — its server interior on screen, the region element
 *    and its content untouched, the frame's hold registered under
 *    frames-rulings 3.1 (hydration-done waits). It mounts with the record
 *    it was held on; the tier discovers the adopted region element and
 *    binds a frame over it, so the stream's chunks reach it.
 *  - Document face, announced: `_$HY.r["sc:tiers"]` names `regions`;
 *    `installServerComponents` starts the import before any boundary
 *    adopts (the warm start the `modulepreload` made a cache hit).
 *  - An occluded region's `sc:region:` record drained BEFORE the tier lands
 *    in the host store regardless (the eager drain arm); the frame the
 *    tier binds on install seeds from it — the region shows the record's
 *    html once the fill places it, with nothing re-delivered.
 *  - Stream face, a MOUNTED occurrence: a new record naming a region while
 *    the tier is absent is not taken — the live binding keeps the args it
 *    shows, the record stays pending in the store — and the install's
 *    flush applies it: the region element is placed and its html lands.
 *
 * A tier, once resident, stays so for the worker: each test gates the load
 * itself (`installServerComponents({ tiers })` replaces the built-in loader)
 * and drops it between tests (`tierLoads`, the runtime's test seam).
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { createRoot, Loading } from "solid-js";
import { dynamic, hydrate } from "@solidjs/web";
import { installServerComponents } from "../../frames/src/client.js";
import { tierLoads } from "../../frames/src/frame-client.js";
import { createServerReference } from "../../server-functions/src/client.js";
import {
  bootPage,
  fillKey,
  frameHtml,
  freshFid,
  hydrationInProgress,
  makeHost,
  onHydrationEnd,
  openFrameResponse,
  pump,
  quiesce,
  slotRange,
  type Page
} from "./support.js";

/** The regions tier's load, gated by the test; `release()` installs the real module. */
function gatedRegions() {
  delete (tierLoads as any).regions;
  let resolve!: (m: any) => void;
  const loader = vi.fn(() => new Promise<any>(r => (resolve = r)));
  return {
    tiers: { regions: loader },
    loader,
    release: async () => resolve(await import("../../frames/src/regions-tier.js"))
  };
}
const resident = () => !!(tierLoads as any).regions?.r;

/** A used region's element as the document carries it inside a fill's output. */
const regionHtml = (childId: string, inner: string) =>
  `<solid-frame data-fid="${childId}" style="display:contents">${inner}</solid-frame>`;
/** The server render of `p => <li>{p.body}</li>` with `body` a used region. */
const regionFillHtml = (fid: string, occurrence: string, childId: string, inner: string) =>
  `<li _hk="${fillKey(fid, occurrence)}">${regionHtml(childId, inner)}</li>`;

let page: Page | undefined;
const disposers: (() => void)[] = [];
afterEach(async () => {
  for (const d of disposers.splice(0)) d();
  await page?.cleanup();
  page = undefined;
  vi.unstubAllGlobals();
  delete (globalThis as any)._$SC;
  document.body.innerHTML = "";
});

describe("the regions tier — document face", () => {
  test("un-announced: a `{$frame}` in an adopted record before the load holds the occurrence (interior and region content on screen, hydration waits); it mounts with the held record on install, the adopted region element bound and reachable by the stream", async () => {
    const gate = gatedRegions();
    const fid = freshFid("tier-regions-a");
    const childId = `${fid}.item#0.body`;
    page = bootPage(
      frameHtml(
        fid,
        `<ul>${slotRange("item#0", regionFillHtml(fid, "item#0", childId, "<em>server body</em>"))}</ul>`
      ),
      { tiers: gate.tiers }
    );
    page.slotRecord(fid, "item#0", { label: "first", body: { $frame: childId } });
    // Nothing announced: no load at install.
    expect(gate.loader).not.toHaveBeenCalled();
    const Comp = (globalThis as any)._$SC.r(fid);
    const li = page.container.querySelector("li")!;
    const regionEl = page.container.querySelector(`solid-frame[data-fid="${childId}"]`)!;
    const em = page.container.querySelector("em")!;
    const mounted: string[] = [];
    const bodies: unknown[] = [];
    let mountedAtEnd = -1;
    let inProgressAtEnd: boolean | undefined;
    const dispose = hydrate(
      () => (
        <Comp
          item={(p: { label: string; body: Element }) => {
            mounted.push(p.label);
            bodies.push(p.body);
            return <li>{p.body}</li>;
          }}
        />
      ),
      page.container
    );
    disposers.push(dispose);
    onHydrationEnd(() => {
      mountedAtEnd = mounted.length;
      inProgressAtEnd = hydrationInProgress();
    });
    await quiesce();
    // The adopt-time sync found the record names a region with the tier
    // absent: it started the load (once) and HELD — no fill ran, the
    // server's nodes are untouched down to the region's content, and
    // hydration is not done (3.1: the hold is a pending boundary).
    expect(gate.loader).toHaveBeenCalledTimes(1);
    expect(resident()).toBe(false);
    expect(mounted).toEqual([]);
    expect(page.container.querySelector("li")).toBe(li);
    expect(page.container.querySelector(`solid-frame[data-fid="${childId}"]`)).toBe(regionEl);
    expect(page.container.querySelector("em")).toBe(em);
    expect(em.textContent).toBe("server body");
    expect(hydrationInProgress()).toBe(true);
    expect(mountedAtEnd).toBe(-1);
    expect(page.errors).toEqual([]);

    // The tier lands: its appliers register, then one flush per live frame.
    // The occurrence mounts ONCE, with the record it was held on; the
    // `{$frame}` resolves to the ADOPTED region element (discovered in the
    // interior, not minted), which the fill places back where it was.
    await gate.release();
    await quiesce();
    await quiesce();
    expect(resident()).toBe(true);
    expect(mounted).toEqual(["first"]);
    expect(bodies).toEqual([regionEl]);
    expect(page.container.querySelector("li")).toBe(li);
    expect(page.container.querySelector(`solid-frame[data-fid="${childId}"]`)).toBe(regionEl);
    expect(em.textContent).toBe("server body");
    // Hydration-done came after the mount, not before; nothing warned, no
    // `TypeError` from a `{$frame}` handed to the fill raw.
    expect(hydrationInProgress()).toBe(false);
    expect(inProgressAtEnd).toBe(false);
    expect(mountedAtEnd).toBe(1);
    expect(page.warnings.filter(w => w.includes("unclaimed"))).toEqual([]);
    expect(page.errors).toEqual([]);

    // The region is a live frame now: a later chunk addressed to its wire
    // id morphs its interior in place.
    page.host.apply({ type: "html", id: childId, version: 1, html: "<em>streamed body</em>" });
    await quiesce();
    expect(page.container.querySelector(`solid-frame[data-fid="${childId}"]`)).toBe(regionEl);
    expect(regionEl.textContent).toBe("streamed body");
    expect(page.errors).toEqual([]);
  });

  test('announced: `_$HY.r["sc:tiers"]` names `regions` — the import starts at install, before any boundary adopts; the held occurrence mounts on the install', async () => {
    const gate = gatedRegions();
    const fid = freshFid("tier-regions-b");
    const childId = `${fid}.item#0.body`;
    page = bootPage(
      frameHtml(
        fid,
        `<ul>${slotRange("item#0", regionFillHtml(fid, "item#0", childId, "<em>one</em>"))}</ul>`
      ),
      { tiers: gate.tiers, records: { "sc:tiers": ["regions"] } }
    );
    // Started at install (the record), ahead of the adopt-time sync.
    expect(gate.loader).toHaveBeenCalledTimes(1);
    expect(resident()).toBe(false);
    page.slotRecord(fid, "item#0", { body: { $frame: childId } });
    const Comp = (globalThis as any)._$SC.r(fid);
    let mounts = 0;
    const dispose = hydrate(
      () => (
        <Comp
          item={(p: { body: Element }) => {
            mounts++;
            return <li>{p.body}</li>;
          }}
        />
      ),
      page.container
    );
    disposers.push(dispose);
    await quiesce();
    // Held on the load the announcement started; asked no second time.
    expect(mounts).toBe(0);
    expect(gate.loader).toHaveBeenCalledTimes(1);
    expect(hydrationInProgress()).toBe(true);
    await gate.release();
    await quiesce();
    await quiesce();
    expect(mounts).toBe(1);
    expect(page.container.textContent).toBe("one");
    expect(hydrationInProgress()).toBe(false);
    expect(page.warnings).toEqual([]);
    expect(page.errors).toEqual([]);
  });

  test("an occluded region's `sc:region:` record drained before the tier lands in the store; the frame the tier binds on install seeds from it when the fill places the region", async () => {
    const gate = gatedRegions();
    const fid = freshFid("tier-regions-c");
    const childId = `${fid}.item#0.body`;
    // The fill's server render placed NO region (occluded — behind an
    // expand), so the interior is the fill's shell alone and the region's
    // html rides the `sc:region:` record.
    page = bootPage(
      frameHtml(
        fid,
        `<ul>${slotRange("item#0", `<li _hk="${fillKey(fid, "item#0")}"><button>expand</button></li>`)}</ul>`
      ),
      { tiers: gate.tiers }
    );
    page.slotRecord(fid, "item#0", { body: { $frame: childId } });
    page.regionRecord(childId, "<p>occluded body</p>");
    const Comp = (globalThis as any)._$SC.r(fid);
    let region: Element | undefined;
    let mounts = 0;
    const dispose = hydrate(
      () => (
        <Comp
          item={(p: { body: Element }) => {
            mounts++;
            region = p.body;
            // Claims the shell in place; places the region later, on expand.
            return (
              <li>
                <button>expand</button>
              </li>
            );
          }}
        />
      ),
      page.container
    );
    disposers.push(dispose);
    await quiesce();
    // Held on the tier; the drain already ran (the records are the page's).
    expect(gate.loader).toHaveBeenCalledTimes(1);
    expect(mounts).toBe(0);
    expect(hydrationInProgress()).toBe(true);
    // The region's record is consumed from `_$HY.r` by the adopt-time
    // drain — before the tier — and sits in the host store under the
    // region's id; delete it from the page so nothing could re-deliver it.
    delete page.hy.r[`sc:region:${childId}`];
    await gate.release();
    await quiesce();
    await quiesce();
    expect(mounts).toBe(1);
    expect(hydrationInProgress()).toBe(false);
    // The region element exists (minted by the tier: nothing to discover in
    // the interior) and its frame — bound off-DOM — already holds the
    // record's html from the store seed.
    expect(region).toBeInstanceOf(Element);
    expect(region!.getAttribute("data-fid")).toBe(childId);
    expect(region!.isConnected).toBe(false);
    expect(region!.textContent).toBe("occluded body");
    // The wrapper expands: the single node goes in, content and all.
    page.container.querySelector("li")!.appendChild(region!);
    expect(page.container.querySelector("li")!.textContent).toBe("expandoccluded body");
    expect(page.errors).toEqual([]);
  });
});

describe("the regions tier — stream face, a mounted occurrence", () => {
  test("a new record naming a region while the tier is absent is not taken: the live binding keeps its args, the record stays pending, and the install's flush applies it — the region element placed, its html landing", async () => {
    const gate = gatedRegions();
    const WIRE = "tier-regions/stream-wire";
    const fid = freshFid("tier-regions-d");
    const getPanel = createServerReference(fid);
    const held = openFrameResponse(WIRE);
    vi.stubGlobal("fetch", async () => held.response);
    const { host } = makeHost();
    installServerComponents(host, { tiers: gate.tiers });
    const Page = dynamic(() => getPanel() as any);
    const labels: string[] = [];
    let div!: HTMLDivElement;
    const dispose = createRoot(d => {
      <div ref={div}>
        <Loading fallback={<span>fallback</span>}>
          <Page
            panel={(p: any) => {
              labels.push(p.label);
              return (
                <div class="wrap">
                  <b>{p.label}</b>
                  {p.body}
                </div>
              );
            }}
          />
        </Loading>
      </div>;
      document.body.appendChild(div);
      return d;
    });
    disposers.push(dispose);
    await pump();
    // The first response: no region, the tier is not needed — the
    // occurrence mounts and shows its label.
    held.send({ type: "start", id: WIRE, version: 1 });
    held.send({ type: "slot", id: WIRE, version: 1, key: "panel#0", args: { label: "plain" } });
    held.send({
      type: "html",
      id: WIRE,
      version: 1,
      html: "<article><!--slot:panel#0:start--><!--slot:panel#0:end--></article>"
    });
    held.send({ type: "complete", id: WIRE, version: 1 });
    held.close();
    await pump();
    expect(labels).toEqual(["plain"]);
    expect(div.querySelector(".wrap b")!.textContent).toBe("plain");
    expect(gate.loader).not.toHaveBeenCalled();

    // A refetch (the next version) adds a `{$frame}` arg — un-announced,
    // written to the ADDRESS the mount is bound to (the argless call's: its
    // function id). The record is NOT taken while the tier is absent: the
    // live binding shows the first record's label, the region's html warms
    // its store, and the check started the load.
    const childId = `${fid}.panel#0.body`;
    host.apply({
      type: "slot",
      id: fid,
      version: 2,
      key: "panel#0",
      args: { label: "with region", body: { $frame: childId } }
    });
    host.apply({ type: "html", id: childId, version: 1, html: "<em>region body</em>" });
    await pump();
    expect(gate.loader).toHaveBeenCalledTimes(1);
    expect(resident()).toBe(false);
    expect(div.querySelector(".wrap b")!.textContent).toBe("plain");
    expect(div.querySelector(".wrap solid-frame")).toBeNull();
    expect(labels).toEqual(["plain"]);

    // The install: the pending record applies into the LIVE binding (no
    // re-call), the region element is placed and seeds from its store.
    await gate.release();
    await pump();
    expect(resident()).toBe(true);
    expect(labels).toEqual(["plain"]);
    expect(div.querySelector(".wrap b")!.textContent).toBe("with region");
    const region = div.querySelector(".wrap solid-frame")!;
    expect(region).not.toBeNull();
    expect(region.getAttribute("data-fid")).toBe(childId);
    expect(region.textContent).toBe("region body");
  });
});
