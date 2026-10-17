/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * Deferred hydration — the frames client's default for adopted occurrences.
 *
 * An occurrence's props are plain record values, so it can mount on its own,
 * in any order. The adoption pass mounts none of them; each mounts at the
 * first of:
 *   - an event inside it (the occurrences enclosing the target, outermost
 *     first, before the event reaches any handler);
 *   - a signal or store write anywhere (every occurrence left, before the
 *     write applies: the server state is what they claim against);
 *   - the idle pass after the load event.
 * Hydration stays in progress until the last one has mounted.
 *
 * The rest of the suite pins adoption-time mounting and runs with deferral
 * off (test/setup-frames-eager.ts); this file turns it on.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { createSignal, flush } from "solid-js";
import { hydrate } from "@solidjs/web";
import { setDeferredHydration } from "../../frames/src/client.js";
import {
  bootPage,
  fillHtml,
  frameHtml,
  freshFid,
  hydrationInProgress,
  onHydrationEnd,
  quiesce,
  slotRange,
  type Page
} from "./support.js";

let page: Page | undefined;
beforeAll(() => setDeferredHydration(true));
afterAll(() => setDeferredHydration(false));
afterEach(async () => {
  await page?.cleanup();
  page = undefined;
});

const OCCURRENCES = ["item#0", "item#1", "item#2"];

function boot(label: string) {
  const fid = freshFid(label);
  page = bootPage(
    frameHtml(fid, `<ul>${OCCURRENCES.map(o => slotRange(o, fillHtml(fid, o, "a"))).join("")}</ul>`)
  );
  OCCURRENCES.forEach(o => page!.slotRecord(fid, o, {}));
  return { fid, page, Comp: (globalThis as any)._$SC.r(fid) };
}

/** Let the idle pass run to the end (no `requestIdleCallback` in jsdom: timers). */
async function idle() {
  for (let i = 0; i < 4; i++) await quiesce();
}

describe("deferred hydration", () => {
  test("the adoption pass mounts nothing; the idle pass mounts every occurrence, then hydration ends", async () => {
    const { page, Comp } = boot("defer-idle");
    const mounted: string[] = [];
    let mountedAtEnd = -1;
    const dispose = hydrate(
      () => <Comp item={() => (mounted.push("x"), (<li>a</li>))} />,
      page.container
    );
    onHydrationEnd(() => (mountedAtEnd = mounted.length));
    expect(mounted.length).toBe(0);
    expect(hydrationInProgress()).toBe(true);
    await idle();
    expect(mounted.length).toBe(3);
    expect(mountedAtEnd).toBe(3);
    expect(hydrationInProgress()).toBe(false);
    expect(page.warnings.filter(w => w.includes("unclaimed"))).toEqual([]);
    expect(page.container.querySelectorAll("li").length).toBe(3);
    dispose();
  });

  test("an event mounts the occurrence it lands in, alone, before the event reaches its handler", async () => {
    const { page, Comp } = boot("defer-event");
    const mounted: number[] = [];
    const clicks: number[] = [];
    const dispose = hydrate(
      () => (
        <Comp
          item={() => {
            const i = mounted.push(1) - 1;
            return <li onClick={() => clicks.push(i)}>a</li>;
          }}
        />
      ),
      page.container
    );
    expect(mounted.length).toBe(0);
    const second = page.container.querySelectorAll("li")[1];
    second.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    // Only the clicked occurrence mounted, it adopted the server's node, and
    // its handler saw the event that woke it.
    expect(mounted.length).toBe(1);
    expect(clicks).toEqual([0]);
    expect(page.container.querySelectorAll("li")[1]).toBe(second);
    expect(hydrationInProgress()).toBe(true);
    await idle();
    expect(mounted.length).toBe(3);
    expect(hydrationInProgress()).toBe(false);
    expect(page.warnings.filter(w => w.includes("unclaimed"))).toEqual([]);
    dispose();
  });

  test("a write before the idle pass mounts every occurrence first, against the server state", async () => {
    const { page, Comp } = boot("defer-write");
    const [label, setLabel] = createSignal("a");
    const seen: string[] = [];
    const dispose = hydrate(
      () => (
        <Comp
          item={() => {
            seen.push(label());
            return <li>{label()}</li>;
          }}
        />
      ),
      page.container
    );
    expect(seen).toEqual([]);
    setLabel("b");
    // Every occurrence mounted inside the write, reading the value the server
    // rendered; the write then applied to all of them.
    expect(seen).toEqual(["a", "a", "a"]);
    flush();
    expect([...page.container.querySelectorAll("li")].map(li => li.textContent)).toEqual([
      "b",
      "b",
      "b"
    ]);
    expect(page.warnings.filter(w => w.includes("unclaimed"))).toEqual([]);
    await idle();
    expect(seen.length).toBe(3);
    expect(hydrationInProgress()).toBe(false);
    dispose();
  });

  test("a frame with no slot range does not defer: hydration ends without waiting for load", async () => {
    // The document is still loading, so an idle pass would wait for the
    // load event; a frame owing nothing must not hold hydration for it.
    vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
    const fid = freshFid("defer-none");
    page = bootPage(frameHtml(fid, "<p>static</p>"));
    const Comp = (globalThis as any)._$SC.r(fid);
    const dispose = hydrate(() => <Comp item={() => <li>a</li>} />, page.container);
    await quiesce();
    expect(hydrationInProgress()).toBe(false);
    expect(page.container.textContent).toBe("static");
    dispose();
  });
});
