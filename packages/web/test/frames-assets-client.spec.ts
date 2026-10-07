/** @vitest-environment jsdom */
// The frames client's stylesheet gate and inline-style application — the
// stream face's analogue of the document runtime's `$dfs` / `$dfc`
// (frame-client.ts: `ensureStylesheet`, `applyInlineStyles`, `#segmentReady`'s
// style term). Pinned here before anything moves (frames savings pass §3 row
// C5: the SC layer audit's one 0-coverage gap, §2.4): what a segment's
// `seg:<k>:assets` record does to the reveal and to the head, as the code
// does it today.
//
//  - A stylesheet named by the record is inserted the moment the segment's
//    content and reveal are both in the store (the placeholder may still be
//    missing — the load overlaps the rest of the stream) and the segment
//    reveals only once the link has SETTLED: `load`, or `error` (an erroring
//    sheet must not hold content forever — the `$dfc` policy). A link already
//    in the document counts as settled. One link per href, document-wide;
//    one waiter per frame on a pending link, however many flushes re-check.
//  - The gate is the ASSETS record, not the reveal chunk's `waitForStyles`
//    flag: the flag is the server's note of what it emitted; the client
//    reads the record.
//  - Inline styles never gate. They land in the head, deduped by
//    `data-asset` id, in entry order, before the segment's content shows.
import { afterEach, describe, expect, it } from "vitest";
import { createFrame, createFrameHost } from "../frames/src/frame-client.js";

afterEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
});

/** A boundary in the body with a frame on it. */
function mount() {
  const boundary = document.createElement("div");
  document.body.appendChild(boundary);
  return { boundary, frame: createFrame(boundary) };
}

/** The shell: one pending placeholder for segment `key`, its fallback in the template. */
const shell = (key: string, fallback = "loading") =>
  `<section><template id="pl-${key}">${fallback}</template><!--pl-${key}--></section>`;

/** The records of one revealed segment: content, reveal gate, assets. */
function segment(key: string, html: string, assets?: Record<string, unknown>) {
  const r: Record<string, unknown> = {
    [`seg:${key}`]: { kind: "html", value: html },
    [`seg:${key}:reveal`]: true
  };
  if (assets) r[`seg:${key}:assets`] = { type: "assets", key, ...assets };
  return r;
}

const links = () => [...document.head.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')];
const styles = () => [...document.head.querySelectorAll<HTMLStyleElement>("style[data-asset]")];
const settle = (link: Element, event: "load" | "error" = "load") =>
  link.dispatchEvent(new Event(event));
/** Whether segment `key` is still pending: its placeholder template is in the range. */
const pending = (root: Element, key: string) => root.querySelector(`template#pl-${key}`) !== null;

describe("the stylesheet gate (ensureStylesheet)", () => {
  it("inserts the segment's stylesheet at once and reveals only when the link loads", () => {
    const { boundary, frame } = mount();
    frame.apply({ version: 1, r: { "": { kind: "html", value: shell("c") } } });
    frame.apply({ version: 1, r: segment("c", "<p>styled</p>", { styles: ["/c.css"] }) });
    // The link is in the head, pending; the segment is not revealed.
    expect(links().map(l => l.getAttribute("href"))).toEqual(["/c.css"]);
    expect(pending(boundary, "c")).toBe(true);
    expect(boundary.querySelector("p")).toBeNull();
    // A re-check before the load changes nothing: no second link, still held.
    frame.apply({ version: 1, r: {} });
    expect(links()).toHaveLength(1);
    expect(pending(boundary, "c")).toBe(true);
    // The load settles the gate: the segment reveals.
    settle(links()[0]);
    expect(pending(boundary, "c")).toBe(false);
    expect(boundary.querySelector("p")!.textContent).toBe("styled");
  });

  it("an erroring stylesheet settles the gate too: the segment reveals (the $dfc policy)", () => {
    const { boundary, frame } = mount();
    frame.apply({ version: 1, r: { "": { kind: "html", value: shell("c") } } });
    frame.apply({ version: 1, r: segment("c", "<p>unstyled</p>", { styles: ["/missing.css"] }) });
    expect(pending(boundary, "c")).toBe(true);
    settle(links()[0], "error");
    expect(pending(boundary, "c")).toBe(false);
    expect(boundary.querySelector("p")!.textContent).toBe("unstyled");
  });

  it("dedupes by href: two segments naming one sheet share one link and both reveal on its load", () => {
    const { boundary, frame } = mount();
    frame.apply({ version: 1, r: { "": { kind: "html", value: shell("a") + shell("b") } } });
    frame.apply({
      version: 1,
      r: {
        ...segment("a", "<p>a</p>", { styles: ["/shared.css"] }),
        ...segment("b", "<p>b</p>", { styles: ["/shared.css", "/b.css"] })
      }
    });
    expect(links().map(l => l.getAttribute("href"))).toEqual(["/shared.css", "/b.css"]);
    expect(pending(boundary, "a")).toBe(true);
    expect(pending(boundary, "b")).toBe(true);
    // `b` names two sheets: one loading does not reveal it.
    settle(links()[0]);
    expect(pending(boundary, "a")).toBe(false);
    expect(pending(boundary, "b")).toBe(true);
    settle(links()[1]);
    expect(pending(boundary, "b")).toBe(false);
    expect(boundary.textContent).toBe("ab");
  });

  it("a stylesheet already in the document counts as settled: the segment reveals at once, no second link", () => {
    const doc = document.createElement("link");
    doc.rel = "stylesheet";
    doc.setAttribute("href", "/doc.css");
    document.head.appendChild(doc);
    const { boundary, frame } = mount();
    frame.apply({ version: 1, r: { "": { kind: "html", value: shell("c") } } });
    frame.apply({ version: 1, r: segment("c", "<p>in</p>", { styles: ["/doc.css"] }) });
    expect(links()).toEqual([doc]);
    expect(pending(boundary, "c")).toBe(false);
    expect(boundary.querySelector("p")!.textContent).toBe("in");
  });

  it("a link this gate created and settled is settled for every later segment naming it", () => {
    const { boundary, frame } = mount();
    frame.apply({ version: 1, r: { "": { kind: "html", value: shell("a") + shell("b") } } });
    frame.apply({ version: 1, r: segment("a", "<p>a</p>", { styles: ["/x.css"] }) });
    settle(links()[0]);
    expect(pending(boundary, "a")).toBe(false);
    // A later segment over the same sheet: no wait, no second link.
    frame.apply({ version: 1, r: segment("b", "<p>b</p>", { styles: ["/x.css"] }) });
    expect(links()).toHaveLength(1);
    expect(pending(boundary, "b")).toBe(false);
  });

  it("an attributed entry `{ href, attrs }` carries its attributes onto the link it creates", () => {
    const { frame } = mount();
    frame.apply({ version: 1, r: { "": { kind: "html", value: shell("c") } } });
    frame.apply({
      version: 1,
      r: segment("c", "<p>x</p>", {
        styles: [{ href: "/print.css", attrs: { media: "print", crossorigin: "", nonce: "n1" } }]
      })
    });
    const [link] = links();
    expect(link.getAttribute("href")).toBe("/print.css");
    expect(link.getAttribute("media")).toBe("print");
    expect(link.getAttribute("crossorigin")).toBe("");
    expect(link.getAttribute("nonce")).toBe("n1");
  });

  it("inserts the link even while the placeholder is missing, so the load overlaps the rest of the stream", () => {
    const { boundary, frame } = mount();
    // The outer segment carries the inner's placeholder; the inner's records
    // land first (content, reveal, assets), its placeholder not yet in the DOM.
    frame.apply({ version: 1, r: { "": { kind: "html", value: shell("outer") } } });
    frame.apply({ version: 1, r: segment("inner", "<p>inner</p>", { styles: ["/inner.css"] }) });
    expect(links().map(l => l.getAttribute("href"))).toEqual(["/inner.css"]);
    expect(boundary.querySelector("p")).toBeNull();
    // The sheet loads before the outer reveals: nothing to reveal into yet.
    settle(links()[0]);
    expect(boundary.querySelector("p")).toBeNull();
    // The outer reveals, bringing the inner's placeholder: the inner reveals
    // in the same pass — its sheet is settled.
    frame.apply({ version: 1, r: segment("outer", shell("inner")) });
    expect(pending(boundary, "outer")).toBe(false);
    expect(pending(boundary, "inner")).toBe(false);
    expect(boundary.querySelector("p")!.textContent).toBe("inner");
  });

  it("the link is inserted at the reveal, not at the assets record: content without a reveal gate requests nothing", () => {
    // The gate's order: content, reveal, THEN styles. An assets record whose
    // segment has no reveal yet (a grouped reveal still owed) does not start
    // the sheet's load — pinned as today's behaviour.
    const { frame } = mount();
    frame.apply({ version: 1, r: { "": { kind: "html", value: shell("c") } } });
    frame.apply({
      version: 1,
      r: {
        "seg:c": { kind: "html", value: "<p>x</p>" },
        "seg:c:assets": { type: "assets", key: "c", styles: ["/late.css"] }
      }
    });
    expect(links()).toEqual([]);
    frame.apply({ version: 1, r: { "seg:c:reveal": true } });
    expect(links().map(l => l.getAttribute("href"))).toEqual(["/late.css"]);
  });

  it("one waiter per frame on a pending link, however many flushes re-check; a shared pending sheet re-flushes every frame", () => {
    const a = mount();
    const b = mount();
    a.frame.apply({ version: 1, r: { "": { kind: "html", value: shell("c") } } });
    b.frame.apply({ version: 1, r: { "": { kind: "html", value: shell("c") } } });
    a.frame.apply({ version: 1, r: segment("c", "<p>a</p>", { styles: ["/both.css"] }) });
    b.frame.apply({ version: 1, r: segment("c", "<p>b</p>", { styles: ["/both.css"] }) });
    const [link] = links();
    expect(links()).toHaveLength(1);
    // Re-checks (unrelated writes) do not pile up waiters.
    a.frame.apply({ version: 1, r: { x: 1 } });
    a.frame.apply({ version: 1, r: { y: 1 } });
    b.frame.apply({ version: 1, r: { x: 1 } });
    expect((link as any)._$frWaiters.size).toBe(2);
    settle(link);
    expect((link as any)._$frWaiters).toBeNull();
    expect(a.boundary.textContent).toBe("a");
    expect(b.boundary.textContent).toBe("b");
  });

  it("a frame disposed while its sheet pends: the settle reveals nothing and throws nothing", () => {
    const { boundary, frame } = mount();
    frame.apply({ version: 1, r: { "": { kind: "html", value: shell("c") } } });
    frame.apply({ version: 1, r: segment("c", "<p>x</p>", { styles: ["/d.css"] }) });
    frame.dispose();
    expect(() => settle(links()[0])).not.toThrow();
    expect(boundary.querySelector("p")).toBeNull();
  });

  it("the gate is the assets record, not the reveal chunk's `waitForStyles` flag", () => {
    // Through the host (chunk form): a reveal with `waitForStyles: false`
    // whose segment's assets record names a stylesheet still waits for it;
    // `waitForStyles: true` with no stylesheet in the record waits for nothing.
    const host = createFrameHost();
    const { boundary } = mount();
    const frame = createFrame(boundary, { id: "wfs", host });
    const chunk = (c: Record<string, unknown>) =>
      host.apply({ id: "wfs", version: 1, ...c } as any);
    chunk({ type: "html", html: shell("a") + shell("b") });
    chunk({ type: "assets", key: "a", styles: ["/a.css"] });
    chunk({ type: "fragment", key: "a", html: "<p>a</p>" });
    chunk({ type: "reveal", keys: ["a"], waitForStyles: false });
    expect(links().map(l => l.getAttribute("href"))).toEqual(["/a.css"]);
    expect(pending(boundary, "a")).toBe(true);
    chunk({ type: "fragment", key: "b", html: "<p>b</p>" });
    chunk({ type: "reveal", keys: ["b"], waitForStyles: true });
    expect(pending(boundary, "b")).toBe(false);
    settle(links()[0]);
    expect(pending(boundary, "a")).toBe(false);
    expect(boundary.textContent).toBe("ab");
    frame.dispose();
  });
});

describe("inline styles (applyInlineStyles)", () => {
  it("land in the head in entry order, with their attributes, before the segment's content shows", () => {
    const { boundary, frame } = mount();
    frame.apply({ version: 1, r: { "": { kind: "html", value: shell("c") } } });
    const mo = new MutationObserver(() => {});
    mo.observe(document.documentElement, { childList: true, subtree: true });
    frame.apply({
      version: 1,
      r: segment("c", "<p>inline</p>", {
        inlineStyles: [
          { id: "s1", content: ".a{color:red}" },
          { id: "s2", content: ".b{color:blue}", attrs: { nonce: "n2", media: "screen" } },
          { id: "s3" }
        ]
      })
    });
    const added = mo
      .takeRecords()
      .flatMap(r => [...r.addedNodes])
      .filter(n => n.nodeType === 1) as Element[];
    mo.disconnect();
    // Head first, then the content.
    const firstContent = added.findIndex(n => n.tagName === "P");
    const lastStyle = added.map(n => n.tagName).lastIndexOf("STYLE");
    expect(firstContent).toBeGreaterThan(-1);
    expect(lastStyle).toBeGreaterThan(-1);
    expect(lastStyle).toBeLessThan(firstContent);
    expect(styles().map(s => s.getAttribute("data-asset"))).toEqual(["s1", "s2", "s3"]);
    expect(styles()[0].textContent).toBe(".a{color:red}");
    expect(styles()[1].getAttribute("nonce")).toBe("n2");
    expect(styles()[1].getAttribute("media")).toBe("screen");
    // An entry without content is an empty element, not "undefined".
    expect(styles()[2].textContent).toBe("");
    expect(boundary.querySelector("p")!.textContent).toBe("inline");
  });

  it("never gate: a segment with inline styles alone reveals at once", () => {
    const { boundary, frame } = mount();
    frame.apply({ version: 1, r: { "": { kind: "html", value: shell("c") } } });
    frame.apply({
      version: 1,
      r: segment("c", "<p>now</p>", { inlineStyles: [{ id: "only", content: "p{}" }] })
    });
    expect(pending(boundary, "c")).toBe(false);
    expect(boundary.querySelector("p")!.textContent).toBe("now");
  });

  it("are idempotent by `data-asset` id: a second segment (or a re-apply) with the same id adds no second element and rewrites nothing", () => {
    const { boundary, frame } = mount();
    frame.apply({ version: 1, r: { "": { kind: "html", value: shell("a") + shell("b") } } });
    frame.apply({
      version: 1,
      r: {
        ...segment("a", "<p>a</p>", { inlineStyles: [{ id: "shared", content: "first" }] }),
        ...segment("b", "<p>b</p>", { inlineStyles: [{ id: "shared", content: "second" }] })
      }
    });
    expect(styles()).toHaveLength(1);
    expect(styles()[0].textContent).toBe("first");
    expect(boundary.textContent).toBe("ab");
    // A new version re-sending the record: the element in the head is adopted.
    frame.apply({
      version: 2,
      r: {
        "": { kind: "html", value: shell("a") },
        ...segment("a", "<p>a2</p>", { inlineStyles: [{ id: "shared", content: "third" }] })
      }
    });
    expect(styles()).toHaveLength(1);
    expect(styles()[0].textContent).toBe("first");
    expect(boundary.textContent).toBe("a2");
  });

  it("adopt a document-emitted `<style data-asset>` instead of duplicating it", () => {
    const doc = document.createElement("style");
    doc.setAttribute("data-asset", "doc");
    doc.textContent = "server";
    document.head.appendChild(doc);
    const { frame } = mount();
    frame.apply({ version: 1, r: { "": { kind: "html", value: shell("c") } } });
    frame.apply({
      version: 1,
      r: segment("c", "<p>x</p>", { inlineStyles: [{ id: "doc", content: "client" }] })
    });
    expect(styles()).toEqual([doc]);
    expect(doc.textContent).toBe("server");
  });

  it("ride the same record as stylesheets: the sheet gates, the inline style lands at the reveal", () => {
    const { boundary, frame } = mount();
    frame.apply({ version: 1, r: { "": { kind: "html", value: shell("c") } } });
    frame.apply({
      version: 1,
      r: segment("c", "<p>both</p>", {
        styles: ["/gate.css"],
        inlineStyles: [{ id: "with-sheet", content: "p{}" }]
      })
    });
    // Held on the sheet: the inline style is not applied yet either (it
    // applies with the reveal, after the gate).
    expect(pending(boundary, "c")).toBe(true);
    expect(styles()).toEqual([]);
    settle(links()[0]);
    expect(pending(boundary, "c")).toBe(false);
    expect(styles().map(s => s.getAttribute("data-asset"))).toEqual(["with-sheet"]);
  });
});
