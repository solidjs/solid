/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * Hydration variant of the element-claim ordering (#3923): a server-rendered
 * anchor is claimed once, after its binding effect has run against the
 * claimed node. Hydration adopts the server's attributes (the write sites
 * return early while hydrating), so the handler observes the server-rendered
 * link state — what #3919's trust rule says a router should rely on during
 * hydration — and later client writes to declared attributes re-claim.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { hydrate, registerElementClaim } from "@solidjs/web";
import { createSignal, flush, getOwner, onCleanup } from "solid-js";

describe("element claims under hydration", () => {
  const container = document.createElement("div");
  let dispose: (() => void) | undefined;
  const cleanups: (() => void)[] = [];

  beforeEach(() => {
    (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
    document.body.appendChild(container);
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    while (cleanups.length) cleanups.pop()!();
    container.remove();
    container.innerHTML = "";
  });

  test("a hydrated anchor with dynamic bindings is claimed once with the server's attributes", () => {
    const seen: { el: Element; href: string | null; target: string | null; owner: boolean }[] = [];
    cleanups.push(
      registerElementClaim(el => {
        seen.push({
          el,
          href: el.getAttribute("href"),
          target: el.getAttribute("target"),
          owner: getOwner() !== null
        });
      })
    );
    const [href, setHref] = createSignal("/client");
    const [target] = createSignal("_blank");
    container.innerHTML = '<a href="/server" target="_blank" _hk="0">link</a>';
    const server = container.firstElementChild!;

    dispose = hydrate(
      () => (
        <a href={href()} target={target()}>
          link
        </a>
      ),
      container
    );
    flush();

    // Same node, claimed exactly once, with the server-rendered link state.
    expect(container.firstElementChild).toBe(server);
    expect(seen).toHaveLength(1);
    expect(seen[0].el).toBe(server);
    expect(seen[0]).toMatchObject({ href: "/server", target: "_blank", owner: true });

    // After hydration a client write to href lands and re-claims.
    setHref("/next");
    flush();
    expect(server.getAttribute("href")).toBe("/next");
    expect(seen).toHaveLength(2);
    expect(seen[1].href).toBe("/next");
  });

  test("a hydrated static anchor and form are claimed once each", () => {
    const seen: string[] = [];
    cleanups.push(
      registerElementClaim(el => {
        seen.push(el.getAttribute("href") ?? el.getAttribute("action")!);
      })
    );
    container.innerHTML =
      '<div _hk="0"><a href="/static" _hk="0-0">s</a><form action="/post" method="post" _hk="0-1"></form></div>';

    dispose = hydrate(
      () => (
        <div>
          <a href="/static">s</a>
          <form action="/post" method="post" />
        </div>
      ),
      container
    );
    flush();
    expect(seen.sort()).toEqual(["/post", "/static"]);
  });

  test("a hydrated spread anchor is claimed once after the spread adopts the server node", () => {
    const seen: { href: string | null; owner: boolean }[] = [];
    const cleaned: string[] = [];
    cleanups.push(
      registerElementClaim(el => {
        seen.push({ href: el.getAttribute("href"), owner: getOwner() !== null });
        onCleanup(() => cleaned.push(el.getAttribute("href")!));
      })
    );
    const [href] = createSignal("/spread");
    const props = {
      get href() {
        return href();
      },
      rel: "noopener"
    };
    container.innerHTML = '<a href="/spread" rel="noopener" _hk="0">s</a>';
    const server = container.firstElementChild!;

    dispose = hydrate(() => <a {...props}>s</a>, container);
    flush();
    expect(container.firstElementChild).toBe(server);
    expect(seen).toEqual([{ href: "/spread", owner: true }]);
    expect(cleaned).toEqual([]);
    dispose();
    dispose = undefined;
    // The claim ran under the hydrating root's owner: disposal runs its cleanup.
    expect(cleaned).toEqual(["/spread"]);
  });
});
