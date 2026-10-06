/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * C4 — a record applies exactly once, in any drain order.
 *
 * "A document record (`sc:slot:*`, `sc:region:*`, an `sc:live` op) and a
 * stream record each take effect on the content a frame shows exactly once,
 * whatever order drains, reveals and chunks interleave; a re-drain never
 * re-invokes a fill or re-pushes unchanged args."
 *
 * Mechanism meant to carry it: frames/src/client.ts
 * `adoptBoundary.drainRecords` (`appliedRecords`, one apply per key),
 * frames/src/frame-client.ts `createFrameHost.write` (the per-address
 * version guard), `FrameImpl.apply` (`argsEquivalent` dedupe of re-sent
 * slot records), `#refArgsUnchanged`, `#appliedHoles` (per-mount hole
 * dedupe by record identity), the `liveOps` log compaction (last op per
 * target) and its replay at adoption.
 *
 * Observation: every fill counts its invocations and watches its args
 * through `createRenderEffect(() => p.text, v => pushes.push(v))` — a
 * re-push of unchanged args would show as a repeated value; hole applies are
 * counted through `frame:applied` (reason "morph") and the DOM frames.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { createRenderEffect } from "solid-js";
import { hydrate } from "@solidjs/web";
import {
  bootPage,
  fillHtml,
  frameHtml,
  freshFid,
  holeHtml,
  macrotask,
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

/** The standard fill, instrumented: one entry per invocation, one per args read. */
const makeFill = (invocations: number[], pushes: string[]) => (p: { text: string }) => {
  invocations.push(1);
  const el = <li>{p.text}</li>;
  createRenderEffect(
    () => p.text,
    v => {
      pushes.push(v);
    }
  );
  return el;
};

/** An empty pending placeholder: revealing it (with "") is a pure re-drain trigger. */
const drainTrigger = (frag: string) => placeholderHtml(frag, "");

/**
 * A fragment the producer wrote (template + settled `_fr`) whose activation
 * is deferred — a reveal-grouped fragment (`deferActivation`): the `$df`
 * comes later, with the group.
 */
function parkFragment(p: Page, key: string, html: string) {
  const fr = p.declareFragment(key);
  const tpl = document.createElement("template");
  tpl.id = key;
  tpl.innerHTML = html;
  p.container.appendChild(tpl);
  fr.settle(true);
  return () => (globalThis as any).$df(key) as number;
}

describe("C4 — a record applies exactly once, in any drain order", () => {
  // Arm (a): record before adoption, then every re-drain path the document
  // face has — a reveal-driven `drainRecords`, the same record re-sent on
  // the live channel — and finally a genuinely changed record (one push) and
  // its own re-send (none).
  test("(a) record-before-adopt: re-drains and an equal re-send neither re-invoke nor re-push; a changed record pushes once", async () => {
    const fid = freshFid("c4a");
    const frag = "c4a-trigger";
    page = bootPage(
      frameHtml(
        fid,
        `<ul>${slotRange("item#0", fillHtml(fid, "item#0", "one"))}${drainTrigger(frag)}</ul>`
      )
    );
    page.declareFragment(frag);
    page.slotRecord(fid, "item#0", { text: "one" });
    const Comp = (globalThis as any)._$SC.r(fid);
    const invocations: number[] = [];
    const pushes: string[] = [];
    const dispose = hydrate(() => <Comp item={makeFill(invocations, pushes)} />, page.container);
    await quiesce();
    expect(invocations.length).toBe(1);
    expect(pushes).toEqual(["one"]);

    // Re-drain 1: a reveal into the region (the `fr.subscribe` cascade).
    page.revealFragment(frag, "");
    await quiesce();
    expect(invocations.length).toBe(1);
    expect(pushes).toEqual(["one"]);

    // Re-drain 2: the same args re-sent as a live slot op (a fresh object,
    // equal by value — the `argsEquivalent` seam).
    page.live.push({ type: "slot", fid, key: "item#0", args: { text: "one" } });
    await quiesce();
    expect(invocations.length).toBe(1);
    expect(pushes).toEqual(["one"]);
    expect(page.container.textContent).toBe("one");

    // A real change: one push into the live occurrence, no re-call.
    page.live.push({ type: "slot", fid, key: "item#0", args: { text: "two" } });
    await quiesce();
    expect(invocations.length).toBe(1);
    expect(pushes).toEqual(["one", "two"]);
    expect(page.container.textContent).toBe("two");

    // …and its own re-send is a no-op again.
    page.live.push({ type: "slot", fid, key: "item#0", args: { text: "two" } });
    await quiesce();
    expect(invocations.length).toBe(1);
    expect(pushes).toEqual(["one", "two"]);
    expect(page.warnings).toEqual([]);
    expect(page.errors).toEqual([]);
    dispose();
  });

  // Arm (b): record AFTER adoption (the #2968 defer), then a re-drain.
  test("(b) record-after-adopt (deferred): the late record applies once; a later re-drain is a no-op", async () => {
    const fid = freshFid("c4b");
    const frag = "c4b-trigger";
    vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
    page = bootPage(
      frameHtml(
        fid,
        `<ul>${slotRange("item#0", fillHtml(fid, "item#0", "one"))}${drainTrigger(frag)}</ul>`
      )
    );
    page.declareFragment(frag);
    const Comp = (globalThis as any)._$SC.r(fid);
    const invocations: number[] = [];
    const pushes: string[] = [];
    const dispose = hydrate(() => <Comp item={makeFill(invocations, pushes)} />, page.container);
    await quiesce();
    expect(invocations.length).toBe(0);
    page.slotRecord(fid, "item#0", { text: "one" });
    await quiesce();
    await quiesce();
    expect(invocations.length).toBe(1);
    expect(pushes).toEqual(["one"]);

    page.revealFragment(frag, "");
    await quiesce();
    expect(invocations.length).toBe(1);
    expect(pushes).toEqual(["one"]);
    expect(page.container.textContent).toBe("one");
    expect(page.warnings).toEqual([]);
    expect(page.errors).toEqual([]);
    dispose();
  });

  // Arm (c): reveal-before-drain — the record rides the fragment (data
  // script, then `$df`): the reveal's drain applies it; a second reveal's
  // drain must not apply it again.
  test("(c) reveal-before-drain: the record a fragment carries applies at its reveal, once; a second reveal's drain is a no-op", async () => {
    const fid = freshFid("c4c");
    const frag = "c4c-frag";
    const trigger = "c4c-trigger";
    page = bootPage(
      frameHtml(fid, `<ul>${placeholderHtml(frag, "<i>loading</i>")}${drainTrigger(trigger)}</ul>`)
    );
    page.declareFragment(frag);
    page.declareFragment(trigger);
    const Comp = (globalThis as any)._$SC.r(fid);
    const invocations: number[] = [];
    const pushes: string[] = [];
    const dispose = hydrate(() => <Comp item={makeFill(invocations, pushes)} />, page.container);
    await quiesce();
    expect(invocations.length).toBe(0);

    page.slotRecord(fid, "item#0", { text: "one" });
    page.revealFragment(frag, slotRange("item#0", fillHtml(fid, "item#0", "one")));
    await quiesce();
    expect(invocations.length).toBe(1);
    expect(pushes).toEqual(["one"]);

    page.revealFragment(trigger, "");
    await quiesce();
    expect(invocations.length).toBe(1);
    expect(pushes).toEqual(["one"]);
    expect(page.container.textContent).toBe("one");
    expect(page.warnings).toEqual([]);
    expect(page.errors).toEqual([]);
    dispose();
  });

  // Arm (d): drain-before-reveal — a reveal-grouped fragment: its template
  // and record are in the document (and the `_fr` settled) when the boundary
  // adopts, but its `$df` is deferred to the group's reveal. The adopt-time
  // drain applies the record while the range is still inside the template;
  // the reveal then brings the range into the shown content. Was red on
  // `next`; green under frames-rulings 2.3/2.4 — a reveal is an apply (the
  // reveal cascade syncs the adopting frame, which finds the range and the
  // record it holds), and `appliedRecords` is a delivery dedupe, not an
  // application: "applied" means shown.
  test("(d) drain-before-reveal: a record drained before its range is shown takes effect once the range is revealed", async () => {
    const fid = freshFid("c4d");
    const frag = "c4d-frag";
    page = bootPage(frameHtml(fid, `<ul>${placeholderHtml(frag, "<i>loading</i>")}</ul>`));
    page.slotRecord(fid, "item#0", { text: "one" });
    const reveal = parkFragment(page, frag, slotRange("item#0", fillHtml(fid, "item#0", "one")));
    const Comp = (globalThis as any)._$SC.r(fid);
    const invocations: number[] = [];
    const pushes: string[] = [];
    const dispose = hydrate(() => <Comp item={makeFill(invocations, pushes)} />, page.container);
    await quiesce();
    // Pending at adopt: the fallback shows, the record is in the store.
    expect(page.container.textContent).toBe("loading");
    expect(invocations.length).toBe(0);

    // The group's reveal.
    expect(reveal()).toBe(1);
    await quiesce();
    await quiesce();
    expect(page.container.textContent).toBe("one");
    // Was observed on next: the range shown (text "one") but the record
    // took effect ZERO times — the adopt-time drain's sync found no
    // `item#0` marker pair (the range was still inside `<template>`), the
    // reveal's drain saw the key as already applied, and no sync followed
    // the reveal. Now the reveal syncs: one invocation, one push.
    expect(invocations.length).toBe(1);
    expect(pushes).toEqual(["one"]);
    expect(page.warnings).toEqual([]);
    expect(page.errors).toEqual([]);
    dispose();
  });

  // Arm (e2): a live hole op arriving AFTER adoption applies once; the same
  // op re-sent (a fresh record of identical html) must not produce a second
  // visible frame nor rebuild the hole's element.
  test("(e2) live hole op after adoption: one morph, element identity kept; an identical re-send shows no new frame", async () => {
    const fid = freshFid("c4e2");
    const hole = 42;
    page = bootPage(frameHtml(fid, `<p>${holeHtml(hole, "<i>a</i>")}</p>`));
    const Comp = (globalThis as any)._$SC.r(fid);
    const applied: string[] = [];
    page.container.addEventListener("frame:applied", (e: any) => applied.push(e.detail.reason));
    const frames = watchFrames(page.container);
    const dispose = hydrate(() => <Comp />, page.container);
    await quiesce();
    const i = page.container.querySelector("i")!;
    expect(frames.frames).toEqual(["a"]);
    expect(applied).toEqual([]);

    page.live.push({ type: "hole", key: `lh:${hole}`, html: "<i>b</i>" });
    await quiesce();
    expect(frames.frames).toEqual(["a", "b"]);
    expect(applied).toEqual(["morph"]);
    expect(page.container.querySelector("i")).toBe(i);

    // The identical op again: a fresh record object (not deduped by
    // identity), but the content it shows is already shown — no new frame,
    // no element churn.
    page.live.push({ type: "hole", key: `lh:${hole}`, html: "<i>b</i>" });
    await quiesce();
    expect(frames.frames).toEqual(["a", "b"]);
    expect(page.container.querySelector("i")).toBe(i);
    expect(page.warnings).toEqual([]);
    expect(page.errors).toEqual([]);
    frames.stop();
    dispose();
  });

  // Arm (e1): a live hole op that arrived BEFORE this boundary adopted — the
  // pump was started by an earlier boundary on the page, so the op is in the
  // `liveOps` log — is replayed at adoption and applies once.
  test("(e1) live hole op before adoption (replayed from the log): one morph at adopt, element identity kept", async () => {
    const fidA = freshFid("c4e1-first");
    const fidB = freshFid("c4e1-second");
    const hole = 43;
    page = bootPage(
      `<div id="a">${frameHtml(fidA, "<p>first</p>")}</div>` +
        `<div id="b">${frameHtml(fidB, `<p>${holeHtml(hole, "<i>a</i>")}</p>`)}</div>`
    );
    const divA = page.container.querySelector("#a") as HTMLElement;
    const divB = page.container.querySelector("#b") as HTMLElement;
    const A = (globalThis as any)._$SC.r(fidA);
    const B = (globalThis as any)._$SC.r(fidB);
    const appliedB: string[] = [];
    divB.addEventListener("frame:applied", (e: any) => appliedB.push(e.detail.reason));
    const frames = watchFrames(divB);

    // Boundary A adopts first: its drain starts the live pump.
    const disposeA = hydrate(() => <A />, divA);
    await quiesce();
    // The op arrives — B has not adopted; A's applier finds no target.
    page.live.push({ type: "hole", key: `lh:${hole}`, html: "<i>b</i>" });
    await macrotask();
    await macrotask();
    expect(frames.frames).toEqual(["a"]);
    expect(appliedB).toEqual([]);

    // B adopts: the log replays into its store and the hole morphs once.
    const i = divB.querySelector("i")!;
    const disposeB = hydrate(() => <B />, divB);
    await quiesce();
    expect(frames.frames).toEqual(["a", "b"]);
    expect(appliedB).toEqual(["morph"]);
    expect(divB.querySelector("i")).toBe(i);
    expect(divA.textContent).toBe("first");
    expect(page.warnings).toEqual([]);
    expect(page.errors).toEqual([]);
    frames.stop();
    disposeB();
    disposeA();
  });
});
