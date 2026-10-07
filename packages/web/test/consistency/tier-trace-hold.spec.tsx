/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * The traces tier's timing pin (frames savings pass §1, row "traces";
 * §3 row C3). The race: an adopt-time record whose literal args carry a
 * `{ $tr, $ta }` marker — or a `data` chunk whose node tree holds the trace
 * plugin's node — before `@solidjs/web/frames/trace` (the materializer + the
 * store engine) has loaded. Lost, the fill would run with an inert marker
 * object (a `TypeError` or wrong content). The bound: ANNOUNCE + HOLD.
 *
 *  - Document face, un-announced (the fallback): the adopt-time sync finds
 *    the marker (`needsTrace`), starts the load and HOLDS the occurrence —
 *    its server interior on screen, the frame's hold registered under
 *    frames-rulings 3.1 (hydration-done waits). It mounts with the record
 *    it was held on (S1 commit 3's held-record mount, generalized): a
 *    record that replaced it meanwhile applies as the args change it is.
 *    No `TypeError`, nothing read inert.
 *  - Document face, announced: `_$HY.r["sc:tiers"]` names `trace`;
 *    `installServerComponents` starts the import before any boundary
 *    adopts (the warm start the `modulepreload` made a cache hit).
 *  - Codec face: a `data` chunk that names `trace` (the sink stamps it on
 *    the chunk carrying the node) awaits the tier before it decodes —
 *    frames-container-lazy-codec.spec has the full arm; here the chunk's
 *    wait alone.
 *
 * A tier, once resident, stays so for the worker: each test gates the load
 * itself (`installServerComponents({ tiers })` replaces the built-in loader)
 * and drops it between tests (`tierLoads`, the runtime's test seam).
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { hydrate } from "@solidjs/web";
import { applyFrameResponse, installServerComponents } from "../../frames/src/client.js";
import { tierLoads } from "../../frames/src/frame-client.js";
import { createChunk } from "../../server-functions/src/shared.js";
import {
  bootPage,
  fillHtml,
  frameHtml,
  freshFid,
  hydrationInProgress,
  makeHost,
  onHydrationEnd,
  pump,
  quiesce,
  slotRange,
  traceMarker,
  type Page
} from "./support.js";

/** The traces tier's load, gated by the test; `release()` installs the real module. */
function gatedTrace() {
  delete (tierLoads as any).trace;
  let resolve!: (m: any) => void;
  const loader = vi.fn(() => new Promise<any>(r => (resolve = r)));
  return {
    tiers: { trace: loader },
    loader,
    release: async () => resolve(await import("../../frames/src/trace-tier.js"))
  };
}
const resident = () => !!(tierLoads as any).trace?.r;

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

describe("the traces tier — document face", () => {
  test("un-announced: a marker in an adopted record's args before the load holds the occurrence (interior on screen, hydration waits); it mounts with the record it was held on and applies a replacement as an args change", async () => {
    const gate = gatedTrace();
    const fid = freshFid("tier-trace-a");
    page = bootPage(
      frameHtml(fid, `<ul>${slotRange("item#0", fillHtml(fid, "item#0", "2"))}</ul>`),
      { tiers: gate.tiers }
    );
    const t0 = traceMarker();
    t0.snapshot({ n: 2 });
    page.slotRecord(fid, "item#0", { label: "first", data: t0.marker });
    // Nothing announced: no load at install.
    expect(gate.loader).not.toHaveBeenCalled();
    const Comp = (globalThis as any)._$SC.r(fid);
    const li = page.container.querySelector("li")!;
    const mounted: string[] = [];
    let readN: (() => number) | undefined;
    let mountedAtEnd = -1;
    let inProgressAtEnd: boolean | undefined;
    const dispose = hydrate(
      () => (
        <Comp
          item={(p: { label: string; data: { n: number } }) => {
            mounted.push(p.label);
            readN = () => p.data.n;
            return <li>{p.data.n}</li>;
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
    // The adopt-time sync found the marker with the tier absent: it started
    // the load (once) and HELD — no fill ran, the server's node and text are
    // untouched, and hydration is not done (3.1: the hold is a pending
    // boundary).
    expect(gate.loader).toHaveBeenCalledTimes(1);
    expect(mounted).toEqual([]);
    expect(page.container.querySelector("li")).toBe(li);
    expect(li.textContent).toBe("2");
    expect(hydrationInProgress()).toBe(true);
    expect(mountedAtEnd).toBe(-1);
    expect(page.errors).toEqual([]);

    // Meanwhile the record is REPLACED — a refetch of the same call (the
    // next version's write; the store is one response's). The interior on
    // screen was rendered from the FIRST record.
    const t1 = traceMarker();
    t1.snapshot({ n: 7 });
    page.host.apply({
      type: "slot",
      id: fid,
      version: 1,
      key: "item#0",
      args: { label: "second", data: t1.marker }
    });
    await quiesce();
    expect(mounted).toEqual([]);

    // The tier lands: its install, then one flush per live frame. The
    // occurrence mounts ONCE, with the record it was held on (the claim —
    // the markup shows `2`), and the replacement applies as an args change:
    // the live mount's props move to the second record's values.
    await gate.release();
    await quiesce();
    await quiesce();
    expect(resident()).toBe(true);
    expect(mounted).toEqual(["first"]);
    expect(page.container.querySelector("li")).toBe(li);
    expect(readN!()).toBe(7);
    expect(li.textContent).toBe("7");
    // Hydration-done came after the mount, not before; nothing warned, no
    // `TypeError` from a marker read inert.
    expect(hydrationInProgress()).toBe(false);
    expect(inProgressAtEnd).toBe(false);
    expect(mountedAtEnd).toBe(1);
    expect(page.warnings.filter(w => w.includes("unclaimed"))).toEqual([]);
    expect(page.errors).toEqual([]);
  });

  test('announced: `_$HY.r["sc:tiers"]` names `trace` — the import starts at install, before any boundary adopts; the held occurrence mounts on the install', async () => {
    const gate = gatedTrace();
    const fid = freshFid("tier-trace-b");
    page = bootPage(
      frameHtml(fid, `<ul>${slotRange("item#0", fillHtml(fid, "item#0", "1"))}</ul>`),
      { tiers: gate.tiers, records: { "sc:tiers": ["trace"] } }
    );
    // Started at install (the record), ahead of the adopt-time sync.
    expect(gate.loader).toHaveBeenCalledTimes(1);
    expect(resident()).toBe(false);
    const trace = traceMarker();
    trace.snapshot({ n: 1 });
    page.slotRecord(fid, "item#0", { data: trace.marker });
    const Comp = (globalThis as any)._$SC.r(fid);
    let mounts = 0;
    const dispose = hydrate(
      () => (
        <Comp
          item={(p: { data: { n: number } }) => {
            mounts++;
            return <li>{p.data.n}</li>;
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
    expect(page.container.textContent).toBe("1");
    expect(hydrationInProgress()).toBe(false);
    expect(page.warnings).toEqual([]);
    expect(page.errors).toEqual([]);
  });
});

describe("the traces tier — codec face", () => {
  test("a `data` chunk that names `trace` waits for the tier before it decodes", async () => {
    const gate = gatedTrace();
    const applied: string[] = [];
    const { host } = makeHost({ applyData: (c: any) => applied.push(c.key) });
    installServerComponents(host, { tiers: gate.tiers });
    const WIRE = "tier-trace/data-wire";
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(c) {
          controller = c;
        }
      }),
      { headers: { "X-Frame-Stream": WIRE } }
    );
    const send = (chunk: any) => controller.enqueue(createChunk(JSON.stringify(chunk)));
    const done = applyFrameResponse(response, host, { as: WIRE, version: 1 });
    send({ type: "start", id: WIRE, version: 1 });
    // The chunk the sink stamps `trace` on: the one whose node is the
    // trace plugin's (an inert node here — the wait is what is pinned).
    send({
      type: "data",
      id: WIRE,
      version: 1,
      key: "arg:user",
      node: null,
      initial: true,
      tiers: ["trace"]
    });
    send({ type: "html", id: WIRE, version: 1, html: "<p>after</p>" });
    await pump();
    expect(gate.loader).toHaveBeenCalledTimes(1);
    expect(applied).toEqual([]);
    expect(host.get(WIRE)).toBeUndefined();
    await gate.release();
    await pump();
    expect(resident()).toBe(true);
    expect(applied).toEqual(["arg:user"]);
    send({ type: "complete", id: WIRE, version: 1 });
    controller.close();
    await done;
  });
});
