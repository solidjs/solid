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
            { href: "/shared.bin", attrs: { as: "fetch", crossorigin: "anonymous" } }
          ]
        }
      }
    });

    let links = [...document.head.querySelectorAll<HTMLLinkElement>('link[rel="preload"]')];
    expect(links).toHaveLength(2);
    expect(links.find(link => link.getAttribute("as") === "image")?.getAttribute("type")).toBe(
      "image/avif"
    );
    expect(
      links.find(link => link.getAttribute("as") === "image")?.getAttribute("fetchpriority")
    ).toBe("high");
    expect(
      links.find(link => link.getAttribute("as") === "fetch")?.getAttribute("crossorigin")
    ).toBe("anonymous");

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

    document.head.querySelector('link[href="/late.woff2"]')!.remove();
    frame.apply({ version: 2, r: { "seg::assets": lateAssets } });
    expect(document.head.querySelector('link[href="/late.woff2"]')).not.toBeNull();
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
