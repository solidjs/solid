/**
 * @vitest-environment jsdom
 *
 * acquireAsset — the client-side ref-counted asset registry. Consumers
 * acquire a descriptor when styled content mounts and call the returned
 * release on cleanup. First acquire creates (or adopts an SSR-emitted)
 * element; last release removes it after a grace period so quick
 * release/re-acquire cycles keep the live element.
 */
import { acquireAsset } from "../../src/client.js";

describe("acquireAsset ref-counted assets", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
  });

  it("creates a stylesheet link on first acquire and removes it after release + grace", () => {
    const release = acquireAsset({ type: "style", href: "/route.css" });
    const link = document.head.querySelector('link[rel="stylesheet"]');
    expect(link).not.toBe(null);
    expect(link.getAttribute("href")).toBe("/route.css");

    release();
    // Still connected during the grace period…
    expect(link.isConnected).toBe(true);
    vi.runAllTimers();
    // …gone after it elapses.
    expect(link.isConnected).toBe(false);
  });

  it("shares one element across acquires and only removes after the last release", () => {
    const r1 = acquireAsset({ type: "style", href: "/shared.css" });
    const r2 = acquireAsset({ type: "style", href: "/shared.css" });
    const links = document.head.querySelectorAll('link[rel="stylesheet"]');
    expect(links.length).toBe(1);

    r1();
    vi.runAllTimers();
    expect(links[0].isConnected).toBe(true);

    r2();
    vi.runAllTimers();
    expect(links[0].isConnected).toBe(false);
  });

  it("re-acquiring within the grace period keeps the element alive", () => {
    const r1 = acquireAsset({ type: "style", href: "/transition.css" });
    const link = document.head.querySelector("link");
    r1();
    // Route transition: released and re-acquired before the grace elapses.
    const r2 = acquireAsset({ type: "style", href: "/transition.css" });
    vi.runAllTimers();
    expect(link.isConnected).toBe(true);
    expect(document.head.querySelectorAll("link").length).toBe(1);
    r2();
    vi.runAllTimers();
    expect(link.isConnected).toBe(false);
  });

  it("adopts an SSR-emitted stylesheet link instead of duplicating it", () => {
    document.head.innerHTML = '<link rel="stylesheet" href="/ssr.css">';
    const ssrLink = document.head.querySelector("link");
    const release = acquireAsset({ type: "style", href: "/ssr.css" });
    expect(document.querySelectorAll("link").length).toBe(1);
    release();
    vi.runAllTimers();
    expect(ssrLink.isConnected).toBe(false);
  });

  it("adopts stream-emitted links wherever they are in the document", () => {
    // Streaming leaves boundary stylesheet links in <body>.
    document.body.innerHTML = '<link rel="stylesheet" href="/streamed.css">';
    acquireAsset({ type: "style", href: "/streamed.css" });
    expect(document.querySelectorAll("link").length).toBe(1);
  });

  it("releasing twice does not double-decrement", () => {
    const r1 = acquireAsset({ type: "style", href: "/double.css" });
    const r2 = acquireAsset({ type: "style", href: "/double.css" });
    const link = document.head.querySelector("link");
    r1();
    r1();
    vi.runAllTimers();
    expect(link.isConnected).toBe(true);
    r2();
    vi.runAllTimers();
    expect(link.isConnected).toBe(false);
  });

  it("creates inline styles with content and adopts SSR-emitted ones by data-asset id", () => {
    const release = acquireAsset({
      type: "inline-style",
      id: "home.css",
      content: ".home{color:red}"
    });
    const style = document.head.querySelector("style");
    expect(style.getAttribute("data-asset")).toBe("home.css");
    expect(style.textContent).toBe(".home{color:red}");
    release();
    vi.runAllTimers();

    // SSR-emitted tag with the same id gets adopted, not duplicated, and
    // its server-rendered content is preserved.
    document.head.innerHTML = '<style data-asset="dev.css">.dev{}</style>';
    acquireAsset({ type: "inline-style", id: "dev.css", content: ".ignored{}" });
    const styles = document.querySelectorAll("style");
    expect(styles.length).toBe(1);
    expect(styles[0].textContent).toBe(".dev{}");
  });

  it("applies extra attributes on mount", () => {
    acquireAsset({
      type: "inline-style",
      id: "attr.css",
      content: ".a{}",
      attrs: { "data-vite-dev-id": "/abs/attr.css" }
    });
    expect(document.head.querySelector("style").getAttribute("data-vite-dev-id")).toBe(
      "/abs/attr.css"
    );
  });

  it("creates modulepreload links for module descriptors", () => {
    acquireAsset({ type: "module", href: "/chunk.js" });
    const link = document.head.querySelector("link");
    expect(link.rel).toBe("modulepreload");
    expect(link.getAttribute("href")).toBe("/chunk.js");
  });

  it("recreates the element if a new acquire finds the previous one disconnected", () => {
    const r1 = acquireAsset({ type: "style", href: "/wiped.css" });
    const link = document.head.querySelector("link");
    // Something external (e.g. head takeover) removed the element.
    link.remove();
    acquireAsset({ type: "style", href: "/wiped.css" });
    expect(document.head.querySelector('link[rel="stylesheet"]')).not.toBe(null);
    r1();
  });
});

describe("acquireAsset exclusive slots", () => {
  // Generic last-writer-wins slot (the title/meta ownership model): no DOM
  // element management, just value application through get/set.
  function titleSlot(value) {
    return {
      policy: "exclusive",
      key: "title",
      value,
      get: () => document.title,
      set: v => (document.title = v)
    };
  }

  beforeEach(() => {
    document.title = "Original";
  });

  it("applies the value and restores the original on release", () => {
    const release = acquireAsset(titleSlot("Page"));
    expect(document.title).toBe("Page");
    release();
    expect(document.title).toBe("Original");
  });

  it("nested writers override and restore in order", () => {
    const outer = acquireAsset(titleSlot("Outer"));
    const inner = acquireAsset(titleSlot("Inner"));
    expect(document.title).toBe("Inner");
    inner();
    expect(document.title).toBe("Outer");
    outer();
    expect(document.title).toBe("Original");
  });

  it("releasing a non-top writer does not change the applied value", () => {
    const outer = acquireAsset(titleSlot("Outer"));
    const inner = acquireAsset(titleSlot("Inner"));
    outer();
    expect(document.title).toBe("Inner");
    inner();
    expect(document.title).toBe("Original");
  });

  it("releasing twice is inert", () => {
    const outer = acquireAsset(titleSlot("Outer"));
    const inner = acquireAsset(titleSlot("Inner"));
    inner();
    inner();
    expect(document.title).toBe("Outer");
    outer();
    expect(document.title).toBe("Original");
  });

  it("captures a fresh original after the slot fully empties", () => {
    const r1 = acquireAsset(titleSlot("First"));
    r1();
    document.title = "Changed Externally";
    const r2 = acquireAsset(titleSlot("Second"));
    expect(document.title).toBe("Second");
    r2();
    expect(document.title).toBe("Changed Externally");
  });
});
