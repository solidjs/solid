/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */

// Mount-once head resources adopt the element the server already emitted
// instead of appending a second one. A responsive image preload has no href
// — the source set is the request — so adoption has to match on a null href
// plus the identity qualifiers, the same rule the frame client applies.
import { describe, expect, test, afterEach } from "vitest";
import { render, useHead } from "../src/index.js";

const preloads = () => document.head.querySelectorAll('link[rel="preload"]');

function serverEmitted(attrs: Record<string, string>) {
  const link = document.createElement("link");
  link.rel = "preload";
  for (const name in attrs) link.setAttribute(name, attrs[name]);
  document.head.appendChild(link);
  return link;
}

function mount(props: Record<string, unknown>) {
  return render(() => {
    useHead({ tag: "link", props: { rel: "preload", ...props } });
    return null;
  }, document.createElement("div"));
}

afterEach(() => {
  for (const link of Array.from(preloads())) link.remove();
});

describe("preload link adoption on the client", () => {
  test("adopts a server-emitted link that carries an href", () => {
    const server = serverEmitted({ href: "/hero.avif", as: "image" });
    mount({ href: "/hero.avif", as: "image" });

    expect(preloads()).toHaveLength(1);
    expect(preloads()[0]).toBe(server);
  });

  test("adopts a source-set link that has no href", () => {
    const server = serverEmitted({
      as: "image",
      imagesrcset: "/card-400.avif 400w, /card-800.avif 800w",
      imagesizes: "100vw"
    });
    mount({
      as: "image",
      imagesrcset: "/card-400.avif 400w, /card-800.avif 800w",
      imagesizes: "100vw"
    });

    expect(preloads()).toHaveLength(1);
    expect(preloads()[0]).toBe(server);
  });

  test("does not adopt across a different source set", () => {
    serverEmitted({ as: "image", imagesrcset: "/a.avif 1x" });
    mount({ as: "image", imagesrcset: "/b.avif 2x" });

    expect(preloads()).toHaveLength(2);
  });

  test("does not adopt an href-bearing link for a source-set request", () => {
    // The fallback href makes these different declarations, and the server
    // identity already treats them as two resources.
    serverEmitted({ href: "/card.avif", as: "image", imagesrcset: "/card-2x.avif 2x" });
    mount({ as: "image", imagesrcset: "/card-2x.avif 2x" });

    expect(preloads()).toHaveLength(2);
  });

  test("does not adopt across a different destination", () => {
    serverEmitted({ href: "/a.bin", as: "fetch", crossorigin: "anonymous" });
    mount({ href: "/a.bin", as: "font", crossorigin: "anonymous" });

    expect(preloads()).toHaveLength(2);
  });

  test("adopts across equivalent CORS spellings", () => {
    // The server writes the value it was handed; an author writes whichever
    // spelling they prefer. Both are the Anonymous state, so this is one
    // request and adoption has to see it as one.
    const server = serverEmitted({ href: "/f.woff2", as: "font", crossorigin: "" });
    mount({ href: "/f.woff2", as: "font", crossorigin: "anonymous" });

    expect(preloads()).toHaveLength(1);
    expect(preloads()[0]).toBe(server);
  });

  test("adopts a bare crossorigin attribute for an authored anonymous", () => {
    const server = serverEmitted({ href: "/g.woff2", as: "font", crossorigin: "ANONYMOUS" });
    mount({ href: "/g.woff2", as: "font", crossorigin: true });

    expect(preloads()).toHaveLength(1);
    expect(preloads()[0]).toBe(server);
  });

  test("does not adopt across a different credentials mode", () => {
    serverEmitted({ href: "/h.woff2", as: "font", crossorigin: "anonymous" });
    mount({ href: "/h.woff2", as: "font", crossorigin: "use-credentials" });

    expect(preloads()).toHaveLength(2);
  });

  test("adopts when a falsy conditional stands in for an absent qualifier", () => {
    const server = serverEmitted({ href: "/i.avif", as: "image" });
    mount({ href: "/i.avif", as: "image", crossorigin: false, media: false });

    expect(preloads()).toHaveLength(1);
    expect(preloads()[0]).toBe(server);
  });
});
