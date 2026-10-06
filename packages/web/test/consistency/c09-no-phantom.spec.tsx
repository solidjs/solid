/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * C9 — no phantom.
 *
 * "No fresh DOM is rendered where server markup for the same occurrence
 * exists: a settled boundary never shows a fallback over settled server
 * markup, no hydration key misses on an adopted range, and no fresh clone
 * replaces a claimable node — whether the fill claims in the adopt pass or
 * after a hold."
 *
 * Mechanism meant to carry it: frames/src/client.ts `claimRender` (keys
 * from the producer's chain, the range declared as claim roots),
 * `slotArgsProxy` (the TRANSPARENT async memo — no hydration id consumed —
 * and the `s`/`v` stamp fast-adopt so a settled record promise reads
 * synchronously in the claim walk), frames/src/frame-container-plugin.ts
 * `materialize` + solid/src/client/hydration.ts `materializeContainerTrace`
 * (the synchronous `.on()` replay so a delivered snapshot reads ready in the
 * claim walk), and `hydratedCreateLoadingBoundary` (a boundary with nothing
 * pending hydrates straight through).
 *
 * Observation: a MutationObserver frame recorder over the container (a
 * fallback frame would appear as a distinct text), the dev key-miss warning,
 * and node identity of the claimed `_hk` element.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { Loading } from "solid-js";
import { hydrate } from "@solidjs/web";
import {
  bootPage,
  fillHtml,
  frameHtml,
  freshFid,
  quiesce,
  serovalPromise,
  slotRange,
  traceMarker,
  watchFrames,
  type Page
} from "./support.js";

let page: Page | undefined;
afterEach(async () => {
  await page?.cleanup();
  page = undefined;
});

const keyMisses = (p: Page) => p.warnings.filter(w => w.includes("Hydration key miss"));

describe("C9 — no phantom", () => {
  // Arm (a): the record's arg is a promise the hydration serializer already
  // stamped settled (`s = 1`, `v`). The fill reads it through the args
  // proxy's async memo inside a client <Loading>: the read must adopt the
  // stamp synchronously — no fallback frame, no key miss, the server <li>
  // is the live node.
  test("(a) settled-stamped async arg read in the fill: no fallback frame, no key miss, node identity", async () => {
    const fid = freshFid("c9a");
    page = bootPage(
      frameHtml(fid, `<ul>${slotRange("item#0", fillHtml(fid, "item#0", "one"))}</ul>`)
    );
    const fr = serovalPromise<string>();
    fr.settle("one");
    page.slotRecord(fid, "item#0", { text: fr.promise });
    const Comp = (globalThis as any)._$SC.r(fid);
    const serverLi = page.container.querySelector("li")!;
    const frames = watchFrames(page.container);
    const invocations: number[] = [];
    const dispose = hydrate(
      () => (
        <Loading fallback={<span>fb</span>}>
          <Comp
            item={(p: { text: string }) => {
              invocations.push(1);
              return <li>{p.text}</li>;
            }}
          />
        </Loading>
      ),
      page.container
    );
    await quiesce();
    await quiesce();
    frames.sample();
    expect(invocations.length).toBe(1);
    expect(frames.frames).toEqual(["one"]);
    expect(page.container.querySelector("li")).toBe(serverLi);
    expect(page.container.querySelectorAll("li").length).toBe(1);
    expect(keyMisses(page)).toEqual([]);
    expect(page.warnings).toEqual([]);
    expect(page.errors).toEqual([]);
    frames.stop();
    dispose();
  });

  // Arm (b): the record's arg is a container trace whose snapshot was
  // delivered before the record executed. Revived at arg-read into a live
  // projection, its first property read in the claim walk must be READY
  // (the stream's synchronous replay) — not a not-ready throw into the
  // covering boundary.
  test("(b) container-trace arg with a delivered snapshot: no fallback frame, no key miss, node identity", async () => {
    const fid = freshFid("c9b");
    page = bootPage(
      frameHtml(fid, `<ul>${slotRange("item#0", fillHtml(fid, "item#0", "1"))}</ul>`)
    );
    const trace = traceMarker();
    trace.snapshot({ n: 1 });
    page.slotRecord(fid, "item#0", { data: trace.marker });
    const Comp = (globalThis as any)._$SC.r(fid);
    const serverLi = page.container.querySelector("li")!;
    const frames = watchFrames(page.container);
    const invocations: number[] = [];
    const dispose = hydrate(
      () => (
        <Loading fallback={<span>fb</span>}>
          <Comp
            item={(p: { data: { n: number } }) => {
              invocations.push(1);
              return <li>{p.data.n}</li>;
            }}
          />
        </Loading>
      ),
      page.container
    );
    await quiesce();
    await quiesce();
    frames.sample();
    expect(invocations.length).toBe(1);
    expect(frames.frames).toEqual(["1"]);
    expect(page.container.querySelector("li")).toBe(serverLi);
    expect(page.container.querySelectorAll("li").length).toBe(1);
    expect(keyMisses(page)).toEqual([]);
    expect(page.warnings).toEqual([]);
    expect(page.errors).toEqual([]);
    frames.stop();
    dispose();
  });

  // Arm (c): a plain fill claiming AFTER the #2968 record defer (the parser
  // still running at adoption, the record landing a beat later). The late
  // claim must still be a claim: same node, no key miss, no fallback.
  test("(c) plain fill claiming after the record defer: no fallback frame, no key miss, node identity", async () => {
    const fid = freshFid("c9c");
    vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
    page = bootPage(
      frameHtml(fid, `<ul>${slotRange("item#0", fillHtml(fid, "item#0", "one"))}</ul>`)
    );
    const Comp = (globalThis as any)._$SC.r(fid);
    const serverLi = page.container.querySelector("li")!;
    const frames = watchFrames(page.container);
    const invocations: number[] = [];
    const dispose = hydrate(
      () => (
        <Loading fallback={<span>fb</span>}>
          <Comp
            item={(p: { text: string }) => {
              invocations.push(1);
              return <li>{p.text}</li>;
            }}
          />
        </Loading>
      ),
      page.container
    );
    await quiesce();
    expect(invocations.length).toBe(0);
    page.slotRecord(fid, "item#0", { text: "one" });
    await quiesce();
    await quiesce();
    frames.sample();
    expect(invocations.length).toBe(1);
    expect(frames.frames).toEqual(["one"]);
    expect(page.container.querySelector("li")).toBe(serverLi);
    expect(page.container.querySelectorAll("li").length).toBe(1);
    expect(keyMisses(page)).toEqual([]);
    expect(page.warnings).toEqual([]);
    expect(page.errors).toEqual([]);
    frames.stop();
    dispose();
  });
});
