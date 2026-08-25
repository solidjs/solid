/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */

// Client CSS reveal gating, end-to-end through the Solid core: useHead
// warms a registered stylesheet as `rel="preload"` at discovery and its
// gating compute reads the load promise through the `waitAsset` seam
// (src/core.ts), so the boundary/transition machinery holds the reveal until
// the sheet settles — content and its CSS reveal together, parity with SSR
// streaming's `$dfs` gate. jsdom never fetches, so load events are
// dispatched manually and server-loaded sheets model `.sheet` directly —
// same technique as the runtime's own head.spec.js.
import { describe, expect, test } from "vitest";
import { createSignal, isPending, Loading, flush } from "solid-js";
import { render, useHead } from "../src/index.js";

function Route(props: { name: string; css: string }) {
  useHead({ tag: "link", props: { rel: "stylesheet", href: props.css } });
  return <main>{props.name}</main>;
}

const microtasks = async (n = 4) => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

const headLink = (href: string) =>
  document.head.querySelector(`link[href="${href}"]`) as HTMLLinkElement;

async function settleLoad(href: string) {
  headLink(href).dispatchEvent(new Event("load"));
  await microtasks();
  flush();
  await microtasks();
}

describe("useHead stylesheet reveal gating — client integration", () => {
  test("initial mount: Loading holds until the sheet loads; warm precedes reveal", async () => {
    const div = document.createElement("div");
    const dispose = render(
      () => (
        <Loading fallback={<span>Loading...</span>}>
          <Route name="home" css="/gate-mount.css" />
        </Loading>
      ),
      div
    );
    flush();

    // Warm at discovery: the fetch (preload) is in flight while the
    // fallback shows — the gate holds the reveal, not the fetch start.
    const link = headLink("/gate-mount.css");
    expect(link.getAttribute("rel")).toBe("preload");
    expect(link.getAttribute("as")).toBe("style");
    expect(div.innerHTML).toContain("Loading...");
    expect(div.innerHTML).not.toContain("<main>");

    await settleLoad("/gate-mount.css");
    expect(div.innerHTML).toContain("<main>home</main>");
    expect(link.getAttribute("rel")).toBe("stylesheet");
    dispose();
  });

  test("route swap: committed content holds until the new route's sheet loads", async () => {
    const div = document.createElement("div");
    const [route, setRoute] = createSignal("a");
    const dispose = render(
      () => (
        <Loading fallback={<span>Loading...</span>}>
          {route() === "a" ? (
            <Route name="A" css="/gate-swap-a.css" />
          ) : (
            <Route name="B" css="/gate-swap-b.css" />
          )}
        </Loading>
      ),
      div
    );
    flush();
    await settleLoad("/gate-swap-a.css");
    expect(div.innerHTML).toContain("<main>A</main>");

    // Navigation: the new branch renders, warms its sheet, and gates. This
    // is the transition hold — the settled boundary does NOT regress to its
    // fallback; the committed view (A's content and A's applied sheet)
    // holds until B's sheet has loaded.
    setRoute("b");
    flush();
    await microtasks();
    expect(div.innerHTML).toContain("<main>A</main>");
    expect(div.innerHTML).not.toContain("<main>B</main>");
    expect(div.innerHTML).not.toContain("Loading...");
    expect(headLink("/gate-swap-b.css").getAttribute("rel")).toBe("preload");
    expect(headLink("/gate-swap-a.css").getAttribute("rel")).toBe("stylesheet");

    // Reveal order: the swap lands only after (and because) the load event
    // fires — content and stylesheet flip in the same reveal.
    await settleLoad("/gate-swap-b.css");
    expect(div.innerHTML).toContain("<main>B</main>");
    expect(div.innerHTML).not.toContain("<main>A</main>");
    expect(headLink("/gate-swap-b.css").getAttribute("rel")).toBe("stylesheet");
    dispose();
  });

  test("the navigation source reads as pending while the gate holds (isPending)", async () => {
    // The sheet itself has nothing to read — the gate pends the branch's
    // computation, not a value. But the navigation SOURCE (a tab/route
    // signal) is upstream state a router probes: isPending over it must
    // report the CSS-gated transition, so "navigating…" affordances work
    // during gated navigations with no extra wiring. The probe lives
    // outside the boundary — a plain signal read can't be not-ready.
    const div = document.createElement("div");
    const [tab, setTab] = createSignal("a");
    const dispose = render(
      () => (
        <div>
          <span>{isPending(() => tab()) ? "navigating" : "idle"}</span>
          <Loading fallback={<span>Loading...</span>}>
            {tab() === "a" ? (
              <Route name="A" css="/gate-pend-a.css" />
            ) : (
              <Route name="B" css="/gate-pend-b.css" />
            )}
          </Loading>
        </div>
      ),
      div
    );
    flush();
    await settleLoad("/gate-pend-a.css");
    expect(div.innerHTML).toContain("<main>A</main>");
    expect(div.innerHTML).toContain("idle");

    setTab("b");
    flush();
    await microtasks();
    // Held on CSS alone: the source reads pending while the committed view
    // holds.
    expect(div.innerHTML).toContain("<main>A</main>");
    expect(div.innerHTML).toContain("navigating");

    await settleLoad("/gate-pend-b.css");
    expect(div.innerHTML).toContain("<main>B</main>");
    expect(div.innerHTML).toContain("idle");
    dispose();
  });

  test("a branch superseded before its sheet loads leaves no applied sheet", async () => {
    const div = document.createElement("div");
    const [route, setRoute] = createSignal("a");
    const dispose = render(
      () => (
        <Loading fallback={<span>Loading...</span>}>
          {route() === "a" ? (
            <Route name="A" css="/gate-sup-a.css" />
          ) : (
            <Route name="B" css="/gate-sup-b.css" />
          )}
        </Loading>
      ),
      div
    );
    flush();
    await settleLoad("/gate-sup-a.css");
    expect(div.innerHTML).toContain("<main>A</main>");

    // Navigate to B, then back to A before B's sheet loads: B's apply is
    // cancelled mid-hold. Throughout, the transition holds the committed A
    // view — no fallback regression.
    setRoute("b");
    flush();
    await microtasks();
    expect(div.innerHTML).toContain("<main>A</main>");
    expect(div.innerHTML).not.toContain("Loading...");
    expect(headLink("/gate-sup-b.css").getAttribute("rel")).toBe("preload");
    setRoute("a");
    flush();
    await microtasks();
    expect(div.innerHTML).toContain("<main>A</main>");

    // The late load must not resurrect the cancelled branch: the sheet is
    // never acquired, the preload stays inert (a cache warm, not a style).
    await settleLoad("/gate-sup-b.css");
    expect(div.innerHTML).toContain("<main>A</main>");
    expect(div.innerHTML).not.toContain("<main>B</main>");
    expect(headLink("/gate-sup-b.css").getAttribute("rel")).toBe("preload");
    dispose();
  });

  test("adopted server-emitted sheet: counts as loaded, no re-fetch, no gate stall", async () => {
    // Hydration parity: by reveal time the server-emitted sheet is already
    // applied. jsdom never loads resources, so model the loaded state.
    const ssr = document.createElement("link");
    ssr.setAttribute("rel", "stylesheet");
    ssr.setAttribute("href", "/gate-adopted.css");
    Object.defineProperty(ssr, "sheet", { value: {} });
    document.head.appendChild(ssr);

    const div = document.createElement("div");
    const dispose = render(
      () => (
        <Loading fallback={<span>Loading...</span>}>
          <Route name="adopted" css="/gate-adopted.css" />
        </Loading>
      ),
      div
    );
    flush();

    // No wait, no duplicate mount: the existing element is adopted in place
    // and content reveals synchronously.
    expect(div.innerHTML).toContain("<main>adopted</main>");
    const links = document.head.querySelectorAll('link[href="/gate-adopted.css"]');
    expect(links.length).toBe(1);
    expect(links[0].getAttribute("rel")).toBe("stylesheet");
    dispose();
  });
});
