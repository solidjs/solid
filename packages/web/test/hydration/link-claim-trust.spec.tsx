/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * The client side of link claims in server HTML (solidjs/solid#3878): a page
 * whose server render ran a link handler (`setLinkClaim`) arrives with its
 * anchors' link state in the HTML and the `links` hydration record. A link
 * consumer (the router's `setupLinkClaims`, solidjs/solid-router#654) reads
 * the record with `hasServerLinkState()` and, for an anchor claimed while
 * the document hydrates, registers it and trusts the server's attributes —
 * no URL resolution at claim time. Without the record, or for an anchor
 * created after hydration, it resolves as it does today. Hydration itself
 * never touches attributes, so the server's state survives the pass.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  hydrate,
  registerElementClaim,
  claimElementTree,
  hasServerLinkState,
  setLinkClaim
} from "@solidjs/web";
import { createSignal, flush, isHydrating, Show } from "solid-js";

// The server's output for `<Nav />` at `/about` — what `renderToString`
// produces with a router handler set (test/server/link-claim.spec.tsx); the
// trailing markers are the closed `<Show>`'s.
const SERVER_HTML =
  '<nav _hk="0">' +
  '<a href="/">Home</a>' +
  '<a href="/about" data-active aria-current="page">About</a>' +
  '<a href="/about/team">Team</a>' +
  "<!--$--><!--/--></nav>";

function Nav(props: { more?: () => boolean }) {
  return (
    <nav>
      <a href="/">Home</a>
      <a href={"/" + "about"}>About</a>
      <a href="/about/team">Team</a>
      <Show when={props.more?.()}>
        <a href="/about">Late</a>
      </Show>
    </nav>
  );
}

/**
 * A router-shaped consumer with the #654 rule: trust the server's state on
 * an anchor claimed during hydration when the page says it has some;
 * resolve otherwise. Counts the resolutions it had to do.
 */
function setupConsumer() {
  const resolved: string[] = [];
  const trusted: string[] = [];
  const unregister = registerElementClaim(el => {
    if (el.nodeName !== "A") return;
    const a = el as HTMLAnchorElement;
    const href = a.getAttribute("href")!;
    if (hasServerLinkState() && isHydrating() && a.isConnected) {
      trusted.push(href);
      return;
    }
    resolved.push(href);
    // what the router does today: resolve the URL and write the state
    const path = new URL(href, "https://app.test/").pathname;
    path === "/about" ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current");
  });
  return { resolved, trusted, unregister };
}

describe("hydrating server HTML that carries link state", () => {
  const container = document.createElement("div");
  let dispose: (() => void) | undefined;
  let unregister: (() => void) | undefined;

  beforeEach(() => {
    document.body.appendChild(container);
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    unregister?.();
    unregister = undefined;
    container.remove();
    container.innerHTML = "";
    delete (globalThis as any)._$HY;
  });

  test("with the `links` record: anchors are trusted at claim, the server's state survives hydration, no URL is resolved", () => {
    (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: { links: 1 }, fe() {} };
    container.innerHTML = SERVER_HTML;
    expect(hasServerLinkState()).toBe(true);
    const consumer = setupConsumer();
    unregister = consumer.unregister;

    dispose = hydrate(() => <Nav />, container);

    expect(consumer.trusted).toEqual(["/", "/about", "/about/team"]);
    expect(consumer.resolved).toEqual([]);
    const current = container.querySelectorAll("[aria-current]");
    expect(current.length).toBe(1);
    expect(current[0].getAttribute("href")).toBe("/about");
    expect(current[0].hasAttribute("data-active")).toBe(true);
    // non-destructive: still readable after hydration
    expect(hasServerLinkState()).toBe(true);
  });

  test("without the record: nothing to trust, the consumer resolves every anchor as today", () => {
    (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
    // A page rendered without the router: no link state in the HTML.
    container.innerHTML = SERVER_HTML.replace(' data-active aria-current="page"', "");
    expect(hasServerLinkState()).toBe(false);
    const consumer = setupConsumer();
    unregister = consumer.unregister;

    dispose = hydrate(() => <Nav />, container);

    expect(consumer.trusted).toEqual([]);
    expect(consumer.resolved).toEqual(["/", "/about", "/about/team"]);
    expect(container.querySelector("[aria-current]")!.getAttribute("href")).toBe("/about");
  });

  test("an anchor created after hydration is resolved, not trusted", () => {
    (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: { links: 1 }, fe() {} };
    container.innerHTML = SERVER_HTML;
    const consumer = setupConsumer();
    unregister = consumer.unregister;
    const [more, setMore] = createSignal(false);

    dispose = hydrate(() => <Nav more={more} />, container);
    expect(consumer.resolved).toEqual([]);

    setMore(true);
    flush();
    expect(consumer.resolved).toEqual(["/about"]);
    expect(container.querySelectorAll('a[aria-current="page"]').length).toBe(2);
  });

  test("adopted server content swept during hydration is trusted the same way", () => {
    (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: { links: 1 }, fe() {} };
    container.innerHTML = SERVER_HTML;
    const consumer = setupConsumer();
    unregister = consumer.unregister;
    // The frames client's sweep over a server-component range it adopts
    // from the document, while the page hydrates.
    dispose = hydrate(() => {
      claimElementTree(container.firstElementChild!);
      return <Nav />;
    }, container);
    expect(consumer.trusted.slice(0, 3)).toEqual(["/", "/about", "/about/team"]);
    expect(consumer.resolved).toEqual([]);
  });

  test("the client stub of setLinkClaim is a no-op", () => {
    expect(setLinkClaim(() => "")).toBe(false);
  });
});
