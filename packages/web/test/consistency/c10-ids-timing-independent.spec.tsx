/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * C10 — hydration ids are timing-independent.
 *
 * "The hydration ids a fill's components claim under are a function of the
 * producer's key chain (`sc-<fid>-<k>-`) alone — identical whether the
 * claim runs in the adopt pass, after the #2968 record defer, after a
 * `{$ref}` wait, or after a fragment reveal."
 *
 * Mechanism meant to carry it: frames/src/client.ts `claimRender`
 * (`createOwner({ id: prefix })` — the prefix is `sc-<claimScope>-<key>-`),
 * frames/src/frame-client.ts `FrameImpl.#invokeSlot` (`ctx.frame` from the
 * producer's `claimScope`, `ctx.key` the occurrence), `slotArgsProxy`
 * (transparent memo, no id consumed) and `liveSlotProps` (a core signal, no
 * id consumed).
 *
 * Observation: the `_hk` of the element each fill's component claims, read
 * through a `ref`, compared with the producer's key `fillKey(fid, occ)`; the
 * dev key-miss warning; node identity.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { hydrate } from "@solidjs/web";
import {
  bootPage,
  fillHtml,
  fillKey,
  frameHtml,
  freshFid,
  placeholderHtml,
  quiesce,
  slotRange,
  type Page
} from "./support.js";

let page: Page | undefined;
afterEach(async () => {
  await page?.cleanup();
  page = undefined;
});

const keyMisses = (p: Page) => p.warnings.filter(w => w.includes("Hydration key miss"));

/** The standard fill, reporting the key its <li> claimed under. */
const keyedFill = (keys: (string | null)[]) => (p: { text: string }) => (
  <li ref={el => keys.push(el.getAttribute("_hk"))}>{p.text}</li>
);

describe("C10 — hydration ids are timing-independent", () => {
  // Path 1: claimed in the adopt pass (record present at t=0).
  test("(a) claimed at t=0: the key is the producer's and the node is the server's", async () => {
    const fid = freshFid("c10a");
    page = bootPage(
      frameHtml(fid, `<ul>${slotRange("item#0", fillHtml(fid, "item#0", "one"))}</ul>`)
    );
    page.slotRecord(fid, "item#0", { text: "one" });
    const Comp = (globalThis as any)._$SC.r(fid);
    const serverLi = page.container.querySelector("li")!;
    const keys: (string | null)[] = [];
    const dispose = hydrate(() => <Comp item={keyedFill(keys)} />, page.container);
    await quiesce();
    await quiesce();
    expect(keys).toEqual([fillKey(fid, "item#0")]);
    expect(page.container.querySelector("li")).toBe(serverLi);
    expect(keyMisses(page)).toEqual([]);
    expect(page.warnings).toEqual([]);
    dispose();
  });

  // Path 2: claimed after the #2968 record defer (parser running at
  // adoption, the record landing a beat later).
  test("(b) claimed after the record defer: the same key, the same node", async () => {
    const fid = freshFid("c10b");
    vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
    page = bootPage(
      frameHtml(fid, `<ul>${slotRange("item#0", fillHtml(fid, "item#0", "one"))}</ul>`)
    );
    // Declared at the marker (S-record), settled a beat after adoption.
    const record = page.declareSlotRecord(fid, "item#0");
    const Comp = (globalThis as any)._$SC.r(fid);
    const serverLi = page.container.querySelector("li")!;
    const keys: (string | null)[] = [];
    const dispose = hydrate(() => <Comp item={keyedFill(keys)} />, page.container);
    await quiesce();
    expect(keys).toEqual([]);
    record.settle({ text: "one" });
    await quiesce();
    await quiesce();
    expect(keys).toEqual([fillKey(fid, "item#0")]);
    expect(page.container.querySelector("li")).toBe(serverLi);
    expect(keyMisses(page)).toEqual([]);
    expect(page.warnings).toEqual([]);
    dispose();
  });

  // Path 3: claimed after a fragment reveal into the adopted region (the
  // record rides the fragment), with a sibling occurrence claimed at t=0 in
  // the same frame — both keys come from the one chain.
  test("(c) claimed after a fragment reveal: the same key family as the t=0 sibling", async () => {
    const fid = freshFid("c10c");
    const frag = "c10c-frag";
    page = bootPage(
      frameHtml(
        fid,
        `<ul>${slotRange("item#0", fillHtml(fid, "item#0", "one"))}${placeholderHtml(
          frag,
          "<i>loading</i>"
        )}</ul>`
      )
    );
    page.declareFragment(frag);
    page.slotRecord(fid, "item#0", { text: "one" });
    const Comp = (globalThis as any)._$SC.r(fid);
    const keys: (string | null)[] = [];
    const dispose = hydrate(() => <Comp item={keyedFill(keys)} />, page.container);
    await quiesce();
    expect(keys).toEqual([fillKey(fid, "item#0")]);

    page.slotRecord(fid, "item#1", { text: "two" });
    page.revealFragment(frag, slotRange("item#1", fillHtml(fid, "item#1", "two")));
    const revealedLi = page.container.querySelectorAll("li")[1];
    await quiesce();
    await quiesce();
    expect(keys).toEqual([fillKey(fid, "item#0"), fillKey(fid, "item#1")]);
    expect(page.container.querySelectorAll("li")[1]).toBe(revealedLi);
    expect(page.container.textContent).toBe("onetwo");
    expect(keyMisses(page)).toEqual([]);
    expect(page.warnings).toEqual([]);
    dispose();
  });
});
