/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * The assets tier's timing pin — the FOUC guard (frames savings pass §1,
 * row "assets"; §3 row C5; §6 decision 2, ruled: tiered WITH the
 * reveal-readiness term). The race: a `reveal` for a segment whose
 * `seg:<k>:assets` record names stylesheets arrives before
 * `@solidjs/web/frames/assets` (the stylesheet gate, the head mirror) has
 * loaded. Lost, the segment would reveal unstyled and the sheet land after
 * — a flash of unstyled content on every cold load of a style-gated
 * fragment. The bound: ANNOUNCE + the READINESS TERM.
 *
 *  - `#segmentReady`: a segment whose assets record names styles while the
 *    tier is not resident is NOT READY. The server's `<Loading>` fallback —
 *    what the placeholder carries — stays on screen; the readiness check
 *    starts the load if nothing announced it. The install's flush
 *    re-evaluates: the tier's gate requests the sheets, and the reveal is
 *    at max(tier load, stylesheet load). No frame between the fallback and
 *    the styled content.
 *  - A segment WITHOUT stylesheets never waits on the tier: it reveals
 *    with the tier absent, and a stream with no asset records never loads
 *    it. Inline styles, modules and typed preloads are not reveal-gating:
 *    they buffer in the store and apply at the install's flush.
 *  - Announced: `X-Frame-Tiers: assets` starts the import before the body
 *    is read; `tiers: ["assets"]` in-band (the sink stamps the first assets
 *    chunk after the head) at the chunk; `_$HY.r["sc:tiers"]` at
 *    `installServerComponents`.
 *
 * Stream face only: the document face's style gate is the core's `$dfs`.
 * A tier, once resident, stays so for the worker: each test gates the load
 * itself (`installServerComponents({ tiers })` replaces the built-in
 * loader) and drops it between tests (`tierLoads`, the runtime's test seam).
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { createRoot, Loading } from "solid-js";
import { dynamic } from "@solidjs/web";
import { applyFrameResponse, installServerComponents } from "../../frames/src/client.js";
import { createFrame, tierLoads } from "../../frames/src/frame-client.js";
import { createServerReference } from "../../server-functions/src/client.js";
import { createChunk } from "../../server-functions/src/shared.js";
import {
  bootPage,
  frameHtml,
  freshFid,
  makeHost,
  pump,
  quiesce,
  watchFrames,
  type Page
} from "./support.js";

/** The assets tier's load, gated by the test; `release()` installs the real module. */
function gatedAssets() {
  delete (tierLoads as any).assets;
  let resolve!: (m: any) => void;
  const loader = vi.fn(() => new Promise<any>(r => (resolve = r)));
  return {
    tiers: { assets: loader },
    loader,
    release: async () => resolve(await import("../../frames/src/assets-tier.js"))
  };
}
const resident = () => !!(tierLoads as any).assets?.r;

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

/** The shell: a pending placeholder per key, the server `<Loading>` fallback in each template. */
const shell = (...keys: string[]) =>
  `<article>${keys
    .map(
      k =>
        `<template id="pl-${k}"><span class="fallback">${k}-loading</span></template><!--pl-${k}-->`
    )
    .join("")}</article>`;

const links = () => [...document.head.querySelectorAll<HTMLLinkElement>("link")];
const styles = () => [...document.head.querySelectorAll<HTMLStyleElement>("style[data-asset]")];
const load = (href: string) =>
  document.head.querySelector(`link[href="${href}"]`)!.dispatchEvent(new Event("load"));

let page: Page | undefined;
const disposers: (() => void)[] = [];
afterEach(async () => {
  for (const d of disposers.splice(0)) d();
  await page?.cleanup();
  page = undefined;
  vi.unstubAllGlobals();
  delete (globalThis as any)._$SC;
  document.head.replaceChildren();
  document.body.innerHTML = "";
});

describe("the FOUC guard — a style-gated segment before the tier", () => {
  test("announced in-band: the fallback stays on screen, no unstyled reveal; the tier's install requests the sheet; the reveal is at the sheet's load", async () => {
    const gate = gatedAssets();
    const WIRE = "tier-assets/fouc";
    const fid = freshFid("tier-assets-a");
    const getStory = createServerReference(fid);
    const held = heldResponse(WIRE);
    vi.stubGlobal("fetch", async () => held.response);
    const { host } = makeHost();
    installServerComponents(host, { tiers: gate.tiers });
    const Story = dynamic(() => getStory() as any);
    let div!: HTMLDivElement;
    const dispose = createRoot(d => {
      <div ref={div}>
        <Loading fallback={<span>outer</span>}>
          <Story />
        </Loading>
      </div>;
      document.body.appendChild(div);
      return d;
    });
    disposers.push(dispose);
    await pump();
    // No head announcement (the sheet is a late segment's): nothing loads yet.
    expect(gate.loader).not.toHaveBeenCalled();
    const seen = watchFrames(div);
    held.send({ type: "start", id: WIRE, version: 1 });
    held.send({ type: "html", id: WIRE, version: 1, html: shell("c") });
    // The server's `<Loading>` outcome: the fallback shows at the placeholder.
    held.send({ type: "reveal", id: WIRE, version: 1, keys: ["c"], fallback: true });
    // The style-gated fragment: its assets chunk is the first after the
    // head, so it carries the announcement; then the content, then the
    // reveal — all before the tier can have landed.
    held.send({
      type: "assets",
      id: WIRE,
      version: 1,
      key: "c",
      styles: ["/c.css"],
      tiers: ["assets"]
    });
    held.send({
      type: "fragment",
      id: WIRE,
      version: 1,
      key: "c",
      html: '<p class="styled">content</p>'
    });
    held.send({ type: "reveal", id: WIRE, version: 1, keys: ["c"], waitForStyles: true });
    held.send({ type: "complete", id: WIRE, version: 1 });
    held.close();
    await pump();
    // The announcement started the load (once); the readiness check found
    // the tier absent and HELD: the fallback is what is on screen, the
    // content is not, and no sheet could have been requested yet.
    expect(gate.loader).toHaveBeenCalledTimes(1);
    expect(resident()).toBe(false);
    expect(div.querySelector(".fallback")!.textContent).toBe("c-loading");
    expect(div.querySelector(".styled")).toBeNull();
    expect(div.querySelector("template#pl-c")).not.toBeNull();
    expect(links()).toEqual([]);
    // The tier lands: its install flushes the frame, the gate requests the
    // sheet — and the segment is STILL held, on the sheet now.
    await gate.release();
    await pump();
    expect(resident()).toBe(true);
    expect(links().map(l => l.getAttribute("href"))).toEqual(["/c.css"]);
    expect(div.querySelector(".fallback")!.textContent).toBe("c-loading");
    expect(div.querySelector(".styled")).toBeNull();
    // Every frame a user could have seen so far ends at the fallback; the
    // content never showed (the "" is the shell landing before the
    // server's fallback reveal — the range empty between two chunks).
    expect(seen.frames).toEqual(["outer", "", "c-loading"]);
    // The sheet loads: the reveal. max(tier, sheet) = the sheet.
    load("/c.css");
    await pump();
    expect(div.querySelector("template#pl-c")).toBeNull();
    expect(div.querySelector(".fallback")).toBeNull();
    expect(div.querySelector(".styled")!.textContent).toBe("content");
    // From the fallback straight to the styled content — nothing unstyled
    // in between.
    seen.stop();
    expect(seen.frames.slice(2)).toEqual(["c-loading", "content"]);
  });

  test("the sheet already in the document: the reveal is at the tier's install (max(tier, sheet) = the tier)", async () => {
    const gate = gatedAssets();
    const doc = document.createElement("link");
    doc.rel = "stylesheet";
    doc.setAttribute("href", "/doc.css");
    document.head.appendChild(doc);
    const WIRE = "tier-assets/doc-sheet";
    const { host } = makeHost();
    installServerComponents(host, { tiers: gate.tiers });
    const boundary = document.createElement("div");
    document.body.appendChild(boundary);
    const frame = createFrame(boundary, { id: WIRE, host });
    disposers.push(() => frame.dispose());
    const held = heldResponse(WIRE);
    const done = applyFrameResponse(held.response, host, { as: WIRE, version: 1 });
    held.send({ type: "start", id: WIRE, version: 1 });
    held.send({ type: "html", id: WIRE, version: 1, html: shell("c") });
    held.send({ type: "reveal", id: WIRE, version: 1, keys: ["c"], fallback: true });
    held.send({ type: "assets", id: WIRE, version: 1, key: "c", styles: ["/doc.css"] });
    held.send({
      type: "fragment",
      id: WIRE,
      version: 1,
      key: "c",
      html: '<p class="styled">in</p>'
    });
    held.send({ type: "reveal", id: WIRE, version: 1, keys: ["c"], waitForStyles: true });
    held.send({ type: "complete", id: WIRE, version: 1 });
    held.close();
    await done;
    // Un-announced: the readiness check started the load, and held.
    expect(gate.loader).toHaveBeenCalledTimes(1);
    expect(boundary.querySelector(".fallback")).not.toBeNull();
    expect(boundary.querySelector(".styled")).toBeNull();
    await gate.release();
    await pump();
    // The gate found the document's link settled: revealed at the install.
    expect(links()).toEqual([doc]);
    expect(boundary.querySelector(".fallback")).toBeNull();
    expect(boundary.querySelector(".styled")!.textContent).toBe("in");
  });
});

describe("what never waits on the tier", () => {
  test("a segment without stylesheets reveals at once with the tier absent; one with inline styles alone reveals too, its style landing at the install", async () => {
    const gate = gatedAssets();
    const WIRE = "tier-assets/unstyled";
    const { host } = makeHost();
    installServerComponents(host, { tiers: gate.tiers });
    const boundary = document.createElement("div");
    document.body.appendChild(boundary);
    const frame = createFrame(boundary, { id: WIRE, host });
    disposers.push(() => frame.dispose());
    const held = heldResponse(WIRE);
    const done = applyFrameResponse(held.response, host, { as: WIRE, version: 1 });
    held.send({ type: "start", id: WIRE, version: 1 });
    held.send({ type: "html", id: WIRE, version: 1, html: shell("styled", "plain", "inline") });
    held.send({
      type: "reveal",
      id: WIRE,
      version: 1,
      keys: ["styled", "plain", "inline"],
      fallback: true
    });
    held.send({
      type: "assets",
      id: WIRE,
      version: 1,
      key: "styled",
      styles: ["/s.css"],
      tiers: ["assets"]
    });
    held.send({ type: "fragment", id: WIRE, version: 1, key: "styled", html: "<p>styled</p>" });
    held.send({ type: "fragment", id: WIRE, version: 1, key: "plain", html: "<p>plain</p>" });
    held.send({
      type: "assets",
      id: WIRE,
      version: 1,
      key: "inline",
      inlineStyles: [{ id: "inline-only", content: "p{}" }]
    });
    held.send({ type: "fragment", id: WIRE, version: 1, key: "inline", html: "<p>inline</p>" });
    held.send({
      type: "reveal",
      id: WIRE,
      version: 1,
      keys: ["styled", "plain", "inline"],
      waitForStyles: true
    });
    held.send({ type: "complete", id: WIRE, version: 1 });
    held.close();
    await done;
    expect(resident()).toBe(false);
    const text = () => [...boundary.querySelectorAll("p")].map(p => p.textContent);
    // The unstyled segments revealed (the grouped reveal's `waitForStyles`
    // is the server's note; the client reads each segment's record); the
    // style-gated one is held on the tier.
    expect(text()).toEqual(["plain", "inline"]);
    expect(boundary.querySelector("template#pl-styled")).not.toBeNull();
    expect(boundary.querySelector(".fallback")!.textContent).toBe("styled-loading");
    // Not reveal-gating, not applied either: the inline style buffers.
    expect(styles()).toEqual([]);
    await gate.release();
    await pump();
    // The install: the inline style lands (once), the sheet is requested.
    expect(styles().map(s => s.getAttribute("data-asset"))).toEqual(["inline-only"]);
    expect(links().map(l => l.getAttribute("href"))).toEqual(["/s.css"]);
    expect(text()).toEqual(["plain", "inline"]);
    load("/s.css");
    await pump();
    expect(text()).toEqual(["styled", "plain", "inline"]);
    expect(styles()).toHaveLength(1);
  });

  test("a stream with no asset records never loads the tier", async () => {
    const gate = gatedAssets();
    const WIRE = "tier-assets/none";
    const { host } = makeHost();
    installServerComponents(host, { tiers: gate.tiers });
    const boundary = document.createElement("div");
    document.body.appendChild(boundary);
    const frame = createFrame(boundary, { id: WIRE, host });
    disposers.push(() => frame.dispose());
    const held = heldResponse(WIRE);
    const done = applyFrameResponse(held.response, host, { as: WIRE, version: 1 });
    held.send({ type: "start", id: WIRE, version: 1 });
    held.send({ type: "html", id: WIRE, version: 1, html: shell("c") });
    held.send({ type: "fragment", id: WIRE, version: 1, key: "c", html: "<p>plain</p>" });
    held.send({ type: "reveal", id: WIRE, version: 1, keys: ["c"], waitForStyles: false });
    held.send({ type: "complete", id: WIRE, version: 1 });
    held.close();
    await done;
    expect(boundary.querySelector("p")!.textContent).toBe("plain");
    expect(gate.loader).not.toHaveBeenCalled();
  });

  test("module and typed preloads buffer until the install, then apply once", async () => {
    const gate = gatedAssets();
    const WIRE = "tier-assets/preloads";
    const { host } = makeHost();
    installServerComponents(host, { tiers: gate.tiers });
    const boundary = document.createElement("div");
    document.body.appendChild(boundary);
    const frame = createFrame(boundary, { id: WIRE, host });
    disposers.push(() => frame.dispose());
    const held = heldResponse(WIRE);
    const done = applyFrameResponse(held.response, host, { as: WIRE, version: 1 });
    held.send({ type: "start", id: WIRE, version: 1 });
    // The shell's pre-flush assets, then the shell.
    held.send({
      type: "assets",
      id: WIRE,
      version: 1,
      key: "",
      modules: ["/entry.js"],
      preloads: [{ href: "/font.woff2", attrs: { as: "font", crossorigin: "" } }]
    });
    held.send({ type: "html", id: WIRE, version: 1, html: "<p>shell</p>" });
    // A late preload: the root's assets key again.
    held.send({
      type: "assets",
      id: WIRE,
      version: 1,
      key: "",
      preloads: [{ href: "/late.webp", attrs: { as: "image" } }]
    });
    held.send({ type: "complete", id: WIRE, version: 1 });
    held.close();
    await done;
    // Un-announced: the walk met the record with the tier absent — it
    // started the load and left the record pending. Content is unaffected.
    expect(boundary.querySelector("p")!.textContent).toBe("shell");
    expect(gate.loader).toHaveBeenCalledTimes(1);
    expect(links()).toEqual([]);
    await gate.release();
    await pump();
    const hrefs = () => links().map(l => `${l.rel}:${l.getAttribute("href")}`);
    expect(hrefs()).toEqual([
      "modulepreload:/entry.js",
      "preload:/font.woff2",
      "preload:/late.webp"
    ]);
    // A later flush re-applies nothing (once per record identity per mount).
    frame.apply({ version: 1, r: {} });
    expect(hrefs()).toEqual([
      "modulepreload:/entry.js",
      "preload:/font.woff2",
      "preload:/late.webp"
    ]);
  });
});

describe("the announcement", () => {
  test("`X-Frame-Tiers: assets` starts the import before the body is read; the held segment reveals on the install + load", async () => {
    const gate = gatedAssets();
    const WIRE = "tier-assets/header";
    const { host } = makeHost();
    installServerComponents(host, { tiers: gate.tiers });
    const boundary = document.createElement("div");
    document.body.appendChild(boundary);
    const frame = createFrame(boundary, { id: WIRE, host });
    disposers.push(() => frame.dispose());
    const held = heldResponse(WIRE, { "X-Frame-Tiers": "assets" });
    const done = applyFrameResponse(held.response, host, { as: WIRE, version: 1 });
    await pump();
    // The head announced it: started before any chunk of the body.
    expect(gate.loader).toHaveBeenCalledTimes(1);
    held.send({ type: "start", id: WIRE, version: 1 });
    held.send({ type: "html", id: WIRE, version: 1, html: shell("c") });
    held.send({ type: "assets", id: WIRE, version: 1, key: "c", styles: ["/h.css"] });
    held.send({ type: "fragment", id: WIRE, version: 1, key: "c", html: "<p>h</p>" });
    held.send({ type: "reveal", id: WIRE, version: 1, keys: ["c"], waitForStyles: true });
    held.send({ type: "complete", id: WIRE, version: 1 });
    held.close();
    await done;
    expect(boundary.querySelector("p")).toBeNull();
    // Asked no second time by the readiness check.
    expect(gate.loader).toHaveBeenCalledTimes(1);
    await gate.release();
    await pump();
    load("/h.css");
    await pump();
    expect(boundary.querySelector("p")!.textContent).toBe("h");
  });

  test('document face: `_$HY.r["sc:tiers"]` names `assets` — the import starts at install', async () => {
    const gate = gatedAssets();
    const fid = freshFid("tier-assets-doc");
    page = bootPage(frameHtml(fid, "<p>plain</p>"), {
      tiers: gate.tiers,
      records: { "sc:tiers": ["assets"] }
    });
    expect(gate.loader).toHaveBeenCalledTimes(1);
    await gate.release();
    await quiesce();
    expect(resident()).toBe(true);
    expect(page.errors).toEqual([]);
  });
});
