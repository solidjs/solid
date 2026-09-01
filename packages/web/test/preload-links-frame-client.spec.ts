/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { createFrame, createFrameHost } from "../frames/src/frame-client.js";

afterEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
});

describe("frame preload links", () => {
  it("applies typed preloads by their full request identity", () => {
    const boundary = document.createElement("div");
    document.body.appendChild(boundary);
    const frame = createFrame(boundary);

    frame.apply({
      version: 1,
      r: {
        "seg::assets": {
          type: "assets",
          key: "",
          preloads: [
            {
              href: "/shared.bin",
              attrs: { as: "image", type: "image/avif", fetchpriority: "high" }
            },
            { href: "/shared.bin", attrs: { as: "fetch", crossorigin: "anonymous" } },
            {
              href: "/card-fallback.avif",
              attrs: {
                as: "image",
                imagesrcset: "/card.avif 1x, /card@2x.avif 2x",
                imagesizes: "20rem"
              }
            },
            {
              attrs: {
                as: "image",
                imagesrcset: "/card.avif 1x, /card@2x.avif 2x",
                imagesizes: "20rem"
              }
            }
          ]
        }
      }
    });

    let links = [...document.head.querySelectorAll<HTMLLinkElement>('link[rel="preload"]')];
    expect(links).toHaveLength(4);
    expect(links.find(link => link.getAttribute("as") === "image")?.getAttribute("type")).toBe(
      "image/avif"
    );
    expect(
      links.find(link => link.getAttribute("as") === "image")?.getAttribute("fetchpriority")
    ).toBe("high");
    expect(
      links.find(link => link.getAttribute("as") === "fetch")?.getAttribute("crossorigin")
    ).toBe("anonymous");
    expect(
      document.head.querySelectorAll(
        'link[rel="preload"][imagesrcset="/card.avif 1x, /card@2x.avif 2x"]'
      )
    ).toHaveLength(2);
    expect(
      document.head.querySelector(
        'link[rel="preload"][imagesrcset="/card.avif 1x, /card@2x.avif 2x"]:not([href])'
      )
    ).not.toBeNull();

    const lateAssets = {
      type: "assets",
      key: "",
      preloads: [{ href: "/late.woff2", attrs: { as: "font", crossorigin: "" } }]
    };
    frame.apply({ version: 1, r: { "seg::assets": lateAssets } });
    expect(document.head.querySelector('link[href="/late.woff2"]')).not.toBeNull();

    frame.apply({
      version: 1,
      r: {
        "seg:duplicate:assets": {
          type: "assets",
          key: "duplicate",
          preloads: [{ href: "/shared.bin", attrs: { as: "image", type: "image/avif" } }]
        }
      }
    });
    links = [...document.head.querySelectorAll<HTMLLinkElement>('link[rel="preload"]')].filter(
      link => link.getAttribute("href") === "/shared.bin" && link.getAttribute("as") === "image"
    );
    expect(links).toHaveLength(1);

    frame.apply({
      version: 1,
      r: {
        "seg:responsive:assets": {
          type: "assets",
          key: "responsive",
          preloads: [
            {
              attrs: {
                as: "image",
                imagesrcset: "/card.avif 1x, /card@2x.avif 2x",
                imagesizes: "20rem"
              }
            }
          ]
        }
      }
    });
    expect(
      document.head.querySelectorAll(
        'link[rel="preload"][imagesrcset="/card.avif 1x, /card@2x.avif 2x"]'
      )
    ).toHaveLength(2);

    document.head.querySelector('link[href="/late.woff2"]')!.remove();
    frame.apply({ version: 2, r: { "seg::assets": lateAssets } });
    expect(document.head.querySelector('link[href="/late.woff2"]')).not.toBeNull();
  });

  it("adopts a document preload across equivalent CORS spellings", () => {
    // A frame chunk carries whichever spelling the server was handed; the
    // document may already hold the other. Both are the Anonymous state.
    const server = document.createElement("link");
    server.rel = "preload";
    server.setAttribute("href", "/f.woff2");
    server.setAttribute("as", "font");
    server.setAttribute("crossorigin", "anonymous");
    document.head.appendChild(server);

    const boundary = document.createElement("div");
    document.body.appendChild(boundary);
    createFrame(boundary).apply({
      version: 1,
      r: {
        "seg::assets": {
          type: "assets",
          key: "",
          preloads: [
            { href: "/f.woff2", attrs: { as: "font", crossorigin: "" } },
            // A different credentials mode is a different request.
            { href: "/f.woff2", attrs: { as: "font", crossorigin: "use-credentials" } }
          ]
        }
      }
    });

    expect(document.head.querySelectorAll('link[href="/f.woff2"]')).toHaveLength(2);
    expect(document.head.querySelector('link[crossorigin="anonymous"]')).toBe(server);
  });

  it("retains every late root asset record until a frame registers", () => {
    const host = createFrameHost();
    host.apply({
      type: "assets",
      id: "warm-assets",
      version: 1,
      key: "",
      modules: ["/warm-module-a.js"]
    });
    host.apply({
      type: "assets",
      id: "warm-assets",
      version: 1,
      key: "",
      modules: ["/warm-module-b.js"]
    });
    host.apply({
      type: "assets",
      id: "warm-assets",
      version: 1,
      key: "",
      preloads: [{ href: "/warm-font.woff2", attrs: { as: "font", crossorigin: "" } }]
    });

    expect(document.head.querySelector("link")).toBeNull();
    const boundary = document.createElement("div");
    document.body.appendChild(boundary);
    createFrame(boundary, { id: "warm-assets", host });
    expect(document.head.querySelector('link[href="/warm-module-a.js"]')).not.toBeNull();
    expect(document.head.querySelector('link[href="/warm-module-b.js"]')).not.toBeNull();
    expect(document.head.querySelector('link[href="/warm-font.woff2"]')).not.toBeNull();
  });
});
