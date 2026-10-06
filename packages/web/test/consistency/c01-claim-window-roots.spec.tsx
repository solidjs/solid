/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * C1 (claim once, under the producer's keys) through the claim window: an
 * adopted occurrence claims by re-entering hydration the way a streamed
 * boundary's resume does (`sharedConfig.hydrateWindow`), gathering its
 * range's keys by the producer prefix into the registry of the root it
 * ADOPTED under. Multi-root pages (#2917): a second `hydrate()` root
 * replaces the live registry/gather pair; a claim the frame makes after
 * that — under its hold, at a fragment's reveal — must still gather against
 * the root that holds the frame, not the one that hydrated last.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { hydrate } from "@solidjs/web";
import {
  bootPage,
  fillHtml,
  frameHtml,
  freshFid,
  hydrationInProgress,
  quiesce,
  slotRange,
  type Page
} from "./support.js";

let page: Page | undefined;
afterEach(async () => {
  await page?.cleanup();
  page = undefined;
});

describe("C1 — an adopted occurrence's claim window gathers against its own root", () => {
  test("a deferred claim after another root hydrated claims the producer's nodes, no key miss", async () => {
    const fid = freshFid("c1w");
    vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
    page = bootPage(
      frameHtml(fid, `<ul>${slotRange("item#0", fillHtml(fid, "item#0", "one"))}</ul>`)
    );
    const Comp = (globalThis as any)._$SC.r(fid);
    const li = page.container.querySelector("li")!;
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
    expect(invocations).toEqual([]);
    expect(hydrationInProgress()).toBe(true);
    // Another root hydrates in the meantime: the live registry/gather pair
    // is its container's now.
    const other = document.createElement("div");
    other.innerHTML = `<p _hk="0">other</p>`;
    document.body.appendChild(other);
    const disposeOther = hydrate(() => <p>other</p>, other);
    await quiesce();
    // The record the parser was still owed: the deferred claim gathers
    // against the frame's root, claims the server's node in place.
    page.slotRecord(fid, "item#0", { text: "one" });
    await quiesce();
    await quiesce();
    expect(invocations).toEqual([1]);
    expect(page.container.querySelector("li")).toBe(li);
    expect(li.textContent).toBe("one");
    expect(page.warnings).toEqual([]);
    expect(hydrationInProgress()).toBe(false);
    disposeOther();
    other.remove();
    dispose();
  });
});
