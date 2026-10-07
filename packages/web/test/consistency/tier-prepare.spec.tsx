/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * The server-announced tier mechanism, client half (frames savings pass
 * §2, Phase B — the seam alone; no tier is cut, so every real name is
 * resident and the loaders here are the test's own).
 *
 * - `prepareTier` is idempotent per name: one import, one promise; a name
 *   with no loader is resident at once.
 * - The document face: `installServerComponents` reads `_$HY.r["sc:tiers"]`
 *   and starts each named tier's load before any adopt-time sync.
 * - The stream face: `X-Frame-Tiers` starts the loads before the body is
 *   read; `chunk.tiers` in-band starts them at the chunk; a `data` chunk
 *   AWAITS the tiers it names before it decodes.
 * - The held set is A2's registered set (frames-rulings 3.1 / 3.2): an
 *   adopt-time occurrence whose tier is not resident is held exactly like
 *   a recordless called occurrence — its positions stay at the server's
 *   values, the frame's hold registers, hydration-done WAITS — and the
 *   install's flush (one per live frame) mounts it and releases the hold.
 *   Un-announced, the readiness check itself starts the load (detection
 *   is the fallback): the same DOM, later.
 * - The stream path buffers and retries: a record for an occurrence whose
 *   tier is absent stays pending in the store until the install's flush.
 *
 * Module state: a tier, once installed, stays resident for the worker —
 * so the two predicate names (`bind`, `regions`) are each held in ONE
 * test below, before anything else in this file makes them resident;
 * every other test uses a fresh name.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { createRoot, Loading } from "solid-js";
import { dynamic, hydrate } from "@solidjs/web";
import { prepareTier, tierLoaders, type TierModule } from "../../frames/src/frame-client.js";
import { applyFrameResponse, installServerComponents } from "../../frames/src/client.js";
import { createServerReference } from "../../server-functions/src/client.js";
import { createChunk } from "../../server-functions/src/shared.js";
import {
  bootPage,
  frameHtml,
  freshFid,
  hydrationInProgress,
  makeHost,
  onHydrationEnd,
  pump,
  quiesce,
  slotRange,
  type Page
} from "./support.js";

/** A loader the test settles: the import's promise, and the module — the
 *  test's `install` hook over the appliers of `module` (a real tier's, when
 *  the mount the install flushes needs them). */
function deferredTier() {
  let resolve!: (m: TierModule) => void;
  const promise = new Promise<TierModule>(r => (resolve = r));
  const install = vi.fn();
  const loader = vi.fn(() => promise);
  return { loader, install, resolve: (module?: object) => resolve({ ...module, install }) };
}

/** A held frame-stream Response with the given extra headers. */
function heldResponse(id: string, headers: Record<string, string> = {}) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    }
  });
  return {
    response: new Response(body, { headers: { "X-Frame-Stream": id, ...headers } }),
    send: (chunk: any) => controller.enqueue(createChunk(JSON.stringify(chunk))),
    close: () => controller.close()
  };
}

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

describe("the held set — bind (adopt path, un-announced: detection starts the load)", () => {
  // The ONE test for `bind` while it is not resident (see the module doc).
  test("an adopted data occurrence waits for its tier: positions untouched, the hold registers under 3.1, hydration-done waits; the install flushes every frame and mounts them", async () => {
    const bind = deferredTier();
    const fidA = freshFid("tier-bind-a");
    const fidB = freshFid("tier-bind-b");
    // Two boundaries, each one binding-slot occurrence with the server's
    // t=0 value at its position.
    const row = (fid: string) =>
      frameHtml(fid, `<ul><li class="server" _s:class="row#0:cls">item</li></ul>`);
    // No `sc:tiers` record — the page did not announce; the records the
    // occurrences need are present, so only the tier holds them.
    page = bootPage(row(fidA) + row(fidB), { tiers: { bind: bind.loader } });
    page.slotRecord(fidA, "row#0", { id: 1 });
    page.slotRecord(fidB, "row#0", { id: 2 });
    // Nothing announced: no load yet.
    expect(bind.loader).not.toHaveBeenCalled();
    const A = (globalThis as any)._$SC.r(fidA);
    const B = (globalThis as any)._$SC.r(fidB);
    const runs: number[] = [];
    let runsAtEnd = -1;
    let inProgressAtEnd: boolean | undefined;
    const fill = (p: any) => {
      runs.push(p.id);
      return { cls: `client-${p.id}` };
    };
    const dispose = hydrate(() => [<A row={fill} />, <B row={fill} />], page.container);
    disposers.push(dispose);
    onHydrationEnd(() => {
      runsAtEnd = runs.length;
      inProgressAtEnd = hydrationInProgress();
    });
    await quiesce();
    // The adopt-time sync found the tier absent: it started the load
    // (detection, the un-announced fallback) — once for two frames…
    expect(bind.loader).toHaveBeenCalledTimes(1);
    // …and HELD: the fills did not run, the positions are the server's.
    expect(runs).toEqual([]);
    const lis = () => [...page!.container.querySelectorAll("li")];
    expect(lis().map(li => li.className)).toEqual(["server", "server"]);
    // The hold is a pending boundary (3.1): hydration is not done.
    expect(hydrationInProgress()).toBe(true);
    expect(runsAtEnd).toBe(-1);
    // The tier lands: its install hook runs once, then one flush per live
    // frame — both occurrences mount with the records they were held on.
    bind.resolve();
    await quiesce();
    await quiesce();
    expect(bind.install).toHaveBeenCalledTimes(1);
    expect(runs.sort()).toEqual([1, 2]);
    expect(
      lis()
        .map(li => li.className)
        .sort()
    ).toEqual(["client-1", "client-2"]);
    // The hold released; hydration-done came after the mounts, not before.
    expect(hydrationInProgress()).toBe(false);
    expect(inProgressAtEnd).toBe(false);
    expect(runsAtEnd).toBe(2);
    expect(page.warnings.filter(w => w.includes("unclaimed"))).toEqual([]);
    expect(page.errors).toEqual([]);
    // Resident from here on: a later ask resolves without a second import.
    await prepareTier("bind");
    expect(bind.loader).toHaveBeenCalledTimes(1);
  });
});

describe("the stream path — regions (announced on the head; the record buffers until the install)", () => {
  // The ONE test for `regions` while it is not resident. `regions` is a REAL
  // tier since C4 (`@solidjs/web/frames/regions`): the mount the install
  // flushes resolves its `{$frame}` through the module's appliers, so the
  // deferred loader settles with the real module (the install hook is the
  // test's own, counted the same way).
  test("`X-Frame-Tiers` starts the load before the body is read; the occurrence's record stays pending in the store until the install's flush mounts it", async () => {
    const regions = deferredTier();
    const WIRE = "tier/regions-wire";
    const fid = freshFid("tier-regions");
    const getPanel = createServerReference(fid);
    const held = heldResponse(WIRE, { "X-Frame-Tiers": "regions" });
    vi.stubGlobal("fetch", async () => held.response);
    const { host } = makeHost();
    installServerComponents(host, { tiers: { regions: regions.loader } });
    const Page = dynamic(() => getPanel() as any);
    let mounts = 0;
    let div!: HTMLDivElement;
    const dispose = createRoot(d => {
      <div ref={div}>
        <Loading fallback={<span>fallback</span>}>
          <Page
            panel={(p: any) => {
              mounts++;
              return <div class="wrap">{p.body}</div>;
            }}
          />
        </Loading>
      </div>;
      document.body.appendChild(div);
      return d;
    });
    disposers.push(dispose);
    await pump();
    // The head announced it: the load started at the response, before
    // any chunk of the body was read.
    expect(regions.loader).toHaveBeenCalledTimes(1);
    // The body: the record names a region, the shell carries its range,
    // the region's own html follows.
    held.send({ type: "start", id: WIRE, version: 1 });
    held.send({
      type: "slot",
      id: WIRE,
      version: 1,
      key: "panel#0",
      args: { body: { $frame: `${WIRE}.panel#0.body` } }
    });
    held.send({
      type: "html",
      id: WIRE,
      version: 1,
      html: "<article><!--slot:panel#0:start--><!--slot:panel#0:end--></article>"
    });
    held.send({
      type: "html",
      id: `${WIRE}.panel#0.body`,
      version: 1,
      html: "<em>server body</em>"
    });
    held.send({ type: "complete", id: WIRE, version: 1 });
    held.close();
    await pump();
    // The shell landed (the frame has content); the occurrence did NOT
    // mount — its tier is absent, so the record stays pending in the store.
    expect(div.querySelector("article")).not.toBeNull();
    expect(mounts).toBe(0);
    expect(div.querySelector(".wrap")).toBeNull();
    // The install (the real tier's appliers, the test's hook): one flush,
    // the pending record applies — the occurrence mounts with the record it
    // was held on, its region inside.
    regions.resolve(await import("../../frames/src/regions-tier.js"));
    await pump();
    expect(regions.install).toHaveBeenCalledTimes(1);
    expect(mounts).toBe(1);
    expect(div.querySelector(".wrap em")!.textContent).toBe("server body");
    // Idempotent: the header's ask and the sync's are one load.
    expect(regions.loader).toHaveBeenCalledTimes(1);
  });
});

describe("prepareTier", () => {
  test("is idempotent per name: one import, the same promise; a name with no loader is resident at once", async () => {
    const t = deferredTier();
    Object.assign(tierLoaders, { "tier/idem": t.loader });
    const p1 = prepareTier("tier/idem");
    const p2 = prepareTier("tier/idem");
    expect(p1).toBe(p2);
    expect(t.loader).toHaveBeenCalledTimes(1);
    expect((p1 as any).r).toBeUndefined();
    t.resolve();
    await p1;
    expect(t.install).toHaveBeenCalledTimes(1);
    // The resident stamp is the module itself (a tier's exports are its
    // dispatch — the assets tier's `gate` / `apply` are read off it).
    expect((p1 as any).r).toEqual({ install: t.install });
    expect(prepareTier("tier/idem")).toBe(p1);
    expect(t.loader).toHaveBeenCalledTimes(1);
    // No loader: nothing to import, resolved.
    const eager = prepareTier("tier/no-such-loader");
    await eager;
    expect(prepareTier("tier/no-such-loader")).toBe(eager);
  });

  test("a module without an `install` hook installs too (resident on load)", async () => {
    let resolve!: (m: any) => void;
    Object.assign(tierLoaders, { "tier/bare": () => new Promise<any>(r => (resolve = r)) });
    const p = prepareTier("tier/bare");
    const bare = {};
    resolve(bare);
    await p;
    expect((p as any).r).toBe(bare);
  });
});

describe('the document face — `_$HY.r["sc:tiers"]`', () => {
  test("installServerComponents reads the record and starts each named tier's load; no record, no load", async () => {
    const t = deferredTier();
    const u = deferredTier();
    const fid = freshFid("tier-record");
    page = bootPage(frameHtml(fid, "<p>plain</p>"), {
      tiers: { "tier/rec-a": t.loader, "tier/rec-b": u.loader, "tier/rec-c": u.loader },
      records: { "sc:tiers": ["tier/rec-a", "tier/rec-b"] }
    });
    // Started at install — before any boundary adopted.
    expect(t.loader).toHaveBeenCalledTimes(1);
    expect(u.loader).toHaveBeenCalledTimes(1);
    t.resolve();
    u.resolve();
    await quiesce();
    expect(t.install).toHaveBeenCalledTimes(1);
    // The record's names only: "tier/rec-c" was never asked for.
    expect(u.install).toHaveBeenCalledTimes(1);
  });

  test("a page with no record announces nothing: no loader runs at install", async () => {
    const t = deferredTier();
    const fid = freshFid("tier-norecord");
    page = bootPage(frameHtml(fid, "<p>plain</p>"), { tiers: { "tier/none": t.loader } });
    await quiesce();
    expect(t.loader).not.toHaveBeenCalled();
  });
});

describe("the stream face — in-band and the codec", () => {
  test("`chunk.tiers` starts the load at the chunk; a `data` chunk awaits the tiers it names before it decodes", async () => {
    const t = deferredTier();
    Object.assign(tierLoaders, { "tier/data": t.loader });
    const applied: string[] = [];
    const { host } = makeHost({
      applyData: (c: any) => applied.push(c.key)
    });
    const WIRE = "tier/data-wire";
    const held = heldResponse(WIRE);
    const done = applyFrameResponse(held.response, host, { as: WIRE, version: 1 });
    held.send({ type: "start", id: WIRE, version: 1 });
    // A record whose node tree needs the tier: the chunk names it.
    held.send({
      type: "data",
      id: WIRE,
      version: 1,
      key: "arg:x",
      node: null,
      initial: true,
      tiers: ["tier/data"]
    });
    held.send({ type: "html", id: WIRE, version: 1, html: "<p>after</p>" });
    await pump();
    // The announcement started the load…
    expect(t.loader).toHaveBeenCalledTimes(1);
    // …and the data chunk is held behind it: nothing decoded, and the
    // chunks behind it in the sequential drain wait too.
    expect(applied).toEqual([]);
    expect(host.get(WIRE)).toBeUndefined();
    t.resolve();
    await pump();
    expect(applied).toEqual(["arg:x"]);
    held.send({ type: "complete", id: WIRE, version: 1 });
    held.close();
    await done;
  });

  test("a non-data chunk's `tiers` starts the load but does not wait; a `data` chunk without `tiers` decodes at once", async () => {
    const t = deferredTier();
    Object.assign(tierLoaders, { "tier/nowait": t.loader });
    const applied: string[] = [];
    const { host } = makeHost({ applyData: (c: any) => applied.push(c.key) });
    const WIRE = "tier/nowait-wire";
    const held = heldResponse(WIRE);
    const done = applyFrameResponse(held.response, host, { as: WIRE, version: 1 });
    held.send({ type: "start", id: WIRE, version: 1 });
    held.send({ type: "html", id: WIRE, version: 1, html: "<p>shell</p>", tiers: ["tier/nowait"] });
    held.send({ type: "data", id: WIRE, version: 1, key: "arg:y", node: null, initial: true });
    held.send({ type: "complete", id: WIRE, version: 1 });
    held.close();
    await pump();
    expect(t.loader).toHaveBeenCalledTimes(1);
    // Neither the html nor the data waited on the still-pending load.
    expect(applied).toEqual(["arg:y"]);
    await done;
    t.resolve();
  });
});
