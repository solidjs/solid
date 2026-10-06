/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * C1 — claim once, or replace, never both, never twice.
 *
 * "Every server-rendered node inside a frame's content is, by quiescence,
 * either claimed exactly once (by the hydrate pass or by the fill that owns
 * its range) or removed by a deliberate replacement — never claimed by two
 * passes, never left in the document beside a fresh clone of itself; a
 * boundary element is adopted by at most one frame."
 *
 * Mechanism meant to carry it: frames/src/client.ts `claimRender` (the
 * range-scoped registry handed over from the root registry), `slotsFor`'s
 * `settle` (in-place output → a claim, anything else → the frame replaces),
 * frames/src/frame-client.ts `FrameImpl.#replaceRange`, client.ts
 * `adoptBoundary` + `claimedBoundaries` (one adopter per element) and
 * `documentBoundary` (a second mount of a claimed id goes fresh).
 */
import { afterEach, describe, expect, test } from "vitest";
import { hydrate, render } from "@solidjs/web";
import {
  bootPage,
  count,
  fillHtml,
  frameHtml,
  freshFid,
  quiesce,
  slotRange,
  type Page
} from "./support.js";

let page: Page | undefined;
afterEach(async () => {
  await page?.cleanup();
  page = undefined;
});

describe("C1 — claim once, or replace, never both, never twice", () => {
  // Arm (a): two render-prop occurrences, records present at adoption. Each
  // fill runs once, claims its server <li> in place (same node object), and
  // the hydrate pass logs no key miss and no unclaimed node.
  test("(a) two occurrences claim once each: no key miss, node identity preserved", async () => {
    const fid = freshFid("c1a");
    page = bootPage(
      frameHtml(
        fid,
        `<ul>${slotRange("item#0", fillHtml(fid, "item#0", "one"))}${slotRange(
          "item#1",
          fillHtml(fid, "item#1", "two")
        )}</ul>`
      )
    );
    page.slotRecord(fid, "item#0", { text: "one" });
    page.slotRecord(fid, "item#1", { text: "two" });
    const Comp = (globalThis as any)._$SC.r(fid);
    const before = [...page.container.querySelectorAll("li")];
    const frameEl = page.container.querySelector("solid-frame")!;
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
    expect(invocations.length).toBe(2);
    const after = [...page.container.querySelectorAll("li")];
    expect(after.length).toBe(2);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    expect(page.container.querySelector("solid-frame")).toBe(frameEl);
    expect(page.container.textContent).toBe("onetwo");
    expect(page.warnings).toEqual([]);
    expect(page.errors).toEqual([]);
    dispose();
  });

  // Arm (b): one occurrence claims, its sibling's fill answers with FRESH
  // nodes (built outside the claim walk). The frame must replace that range
  // wholesale — the server node leaves the document, nothing is duplicated
  // — while the claiming sibling is untouched.
  test("(b) a fill returning fresh nodes replaces its range; no server node of the range is left beside the clone", async () => {
    const fid = freshFid("c1b");
    page = bootPage(
      frameHtml(
        fid,
        `<ul>${slotRange("item#0", fillHtml(fid, "item#0", "one"))}${slotRange(
          "item#1",
          fillHtml(fid, "item#1", "two")
        )}</ul>`
      )
    );
    page.slotRecord(fid, "item#0", { text: "one" });
    page.slotRecord(fid, "item#1", { text: "two" });
    const Comp = (globalThis as any)._$SC.r(fid);
    const [serverOne, serverTwo] = [...page.container.querySelectorAll("li")];
    const invocations: number[] = [];
    const dispose = hydrate(
      () => (
        <Comp
          item={(p: { text: string }) => {
            // Occurrences mount in document order: item#0 claims, item#1
            // answers with a deliberate replacement — a node the claim walk
            // never saw. (No prop read in the body: that is an untracked
            // read dev names, and not what this pin is about.)
            if (invocations.push(1) === 2) {
              const el = document.createElement("li");
              el.className = "fresh";
              el.textContent = "fresh:two";
              return el;
            }
            return <li>{p.text}</li>;
          }}
        />
      ),
      page.container
    );
    await quiesce();
    await quiesce();
    expect(invocations.length).toBe(2);
    const lis = [...page.container.querySelectorAll("li")];
    expect(lis.length).toBe(2);
    expect(lis[0]).toBe(serverOne);
    expect(lis[1]).not.toBe(serverTwo);
    expect(lis[1].className).toBe("fresh");
    expect(serverTwo.isConnected).toBe(false);
    expect(page.container.textContent).toBe("onefresh:two");
    expect(page.warnings).toEqual([]);
    expect(page.errors).toEqual([]);
    dispose();
  });

  // Arm (c): the boundary is adopted once. A second mount of the same
  // function (a later client render of the placeholder component, after the
  // first mount adopted) must mount a FRESH frame element — never re-adopt,
  // never touch the adopted element or re-run its fills.
  test("(c) a second mount of an adopted function mounts fresh; the adopted element is untouched", async () => {
    const fid = freshFid("c1c");
    page = bootPage(
      frameHtml(fid, `<ul>${slotRange("item#0", fillHtml(fid, "item#0", "one"))}</ul>`)
    );
    page.slotRecord(fid, "item#0", { text: "one" });
    const Comp = (globalThis as any)._$SC.r(fid);
    const adoptedEl = page.container.querySelector("solid-frame")!;
    const serverLi = page.container.querySelector("li")!;
    const first: number[] = [];
    const second: number[] = [];
    const dispose = hydrate(
      () => (
        <Comp
          item={(p: { text: string }) => {
            first.push(1);
            return <li>{p.text}</li>;
          }}
        />
      ),
      page.container
    );
    await quiesce();
    expect(first.length).toBe(1);

    // The second mount: a plain client render of the same placeholder
    // component elsewhere in the page.
    const other = document.createElement("div");
    document.body.appendChild(other);
    const disposeOther = render(
      () => (
        <Comp
          item={(p: { text: string }) => {
            second.push(1);
            return <li>{p.text}</li>;
          }}
        />
      ),
      other
    );
    await quiesce();
    const freshEl = other.querySelector("solid-frame");
    expect(freshEl).not.toBeNull();
    expect(freshEl).not.toBe(adoptedEl);
    expect(freshEl!.getAttribute("data-fid")).toBe(fid);
    // Fresh means fresh: no content, no fill, no adoption of the page's node.
    expect(count(other, "li")).toBe(0);
    expect(second.length).toBe(0);
    // The adopted element stands exactly as it was.
    expect(page.container.querySelector("solid-frame")).toBe(adoptedEl);
    expect(page.container.querySelector("li")).toBe(serverLi);
    expect(adoptedEl.textContent).toBe("one");
    expect(first.length).toBe(1);
    expect(page.warnings).toEqual([]);
    expect(page.errors).toEqual([]);
    disposeOther();
    other.remove();
    dispose();
  });
});
