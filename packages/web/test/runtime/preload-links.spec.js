/**
 * @vitest-environment jsdom
 */
import * as r from "../../src/server.js";
import { renderToFrameStream } from "../../frames/src/frame-sink.js";
import { sharedConfig } from "solid-js";
import { describe, expect, it, vi } from "vitest";

globalThis.TextEncoder = function () {
  return { encode: value => value };
};

function pipeToString(stream) {
  return new Promise(resolve => {
    const chunks = [];
    stream.pipe({
      write(value) {
        chunks.push(value);
      },
      end() {
        resolve(chunks.join(""));
      }
    });
  });
}

describe("typed preload links", () => {
  it("collects explicit links from the static manifest graph", () => {
    const manifest = {
      _base: "/assets/",
      "app.tsx": {
        file: "app.js",
        imports: ["shared.tsx"],
        dynamicImports: ["lazy.tsx"],
        assets: ["not-automatically-preloaded.png"],
        isEntry: true,
        preloads: [
          { href: "", as: "image" },
          { href: "hero.avif", as: "image", type: "image/avif", fetchpriority: "high" }
        ]
      },
      "shared.tsx": {
        file: "shared.js",
        preloads: [
          {
            href: "fonts/app.woff2?v=1",
            as: "font",
            type: "font/woff2",
            crossorigin: ""
          }
        ]
      },
      "lazy.tsx": {
        file: "lazy.js",
        preloads: [{ href: "hidden.webp", as: "image" }]
      }
    };

    let resolved;
    const html = r.renderToString(
      () => {
        resolved = sharedConfig.context.resolveAssets("app.tsx");
        return r.ssr`<html><head></head><body></body></html>`;
      },
      { manifest }
    );

    expect(resolved.preloads).toEqual([
      { href: "/assets/hero.avif", as: "image", type: "image/avif", fetchpriority: "high" },
      {
        href: "/assets/fonts/app.woff2?v=1",
        as: "font",
        type: "font/woff2",
        crossorigin: ""
      }
    ]);
    expect(html).toContain(
      '<link rel="preload" href="/assets/hero.avif" as="image" type="image/avif" fetchpriority="high">'
    );
    expect(html).toContain(
      '<link rel="preload" href="/assets/fonts/app.woff2?v=1" as="font" type="font/woff2" crossorigin="">'
    );
    expect(html).not.toContain("hidden.webp");
    expect(html).not.toContain("not-automatically-preloaded.png");
  });

  it("preserves fetch metadata and dedupes by resource identity", () => {
    const html = r.renderToString(() => {
      const ctx = sharedConfig.context;
      const image = {
        href: '/hero.avif?size="wide"',
        as: "image",
        type: "image/avif",
        integrity: "sha384-image",
        referrerpolicy: "no-referrer",
        fetchpriority: "high",
        media: "(min-width: 60rem)"
      };
      ctx.registerAsset("preload", image);
      ctx.registerAsset("preload", image);
      ctx.registerAsset("preload", { ...image, integrity: "sha384-conflict" });
      ctx.registerAsset("preload", {
        href: image.href,
        as: "fetch",
        crossorigin: "anonymous"
      });
      ctx.registerAsset("preload", { ...image, crossorigin: true });
      ctx.registerAsset("preload", { ...image, crossorigin: "" });
      return r.ssr`<html><head></head><body></body></html>`;
    });

    expect(html.match(/href="\/hero\.avif\?size=&quot;wide&quot;"/g)).toHaveLength(3);
    const image = html.match(/<link[^>]*sha384-image[^>]*>/)[0];
    expect(image).toContain('as="image"');
    expect(image).toContain('type="image/avif"');
    expect(image).toContain('referrerpolicy="no-referrer"');
    expect(image).toContain('fetchpriority="high"');
    expect(image).toContain('media="(min-width: 60rem)"');
    expect(image).not.toContain("nonce");
    expect(html.match(/crossorigin=""/g)).toHaveLength(1);
    expect(html).not.toContain("sha384-conflict");
  });

  it("routes nonces and delivers links through onHead", () => {
    let embeddedHead;
    const html = r.renderToString(
      () => {
        const ctx = sharedConfig.context;
        ctx.registerAsset("preload", { href: "/script.bin", as: "SCRIPT" });
        ctx.registerAsset("preload", { href: "/style.bin", as: "style" });
        ctx.registerAsset("preload", {
          href: "/font.bin",
          as: "font",
          crossorigin: ""
        });
        return r.ssr`<main>embedded</main>`;
      },
      {
        nonce: { script: "script-nonce", style: "style-nonce" },
        onHead: value => (embeddedHead = value)
      }
    );

    expect(html).toBe("<main>embedded</main>");
    expect(embeddedHead.match(/<link[^>]*\/script\.bin[^>]*>/)[0]).toContain(
      'nonce="script-nonce"'
    );
    expect(embeddedHead.match(/<link[^>]*\/style\.bin[^>]*>/)[0]).toContain('nonce="style-nonce"');
    expect(embeddedHead.match(/<link[^>]*\/font\.bin[^>]*>/)[0]).not.toContain("nonce");
  });

  it("dedupes against useHead in either registration order", () => {
    const before = r.renderToString(() => {
      const link = {
        href: "/before.avif",
        as: "image",
        type: "image/avif",
        crossorigin: true
      };
      sharedConfig.context.registerAsset("preload", link);
      r.useHead({
        tag: "link",
        props: { rel: "preload", ...link, crossorigin: "" }
      });
      return r.ssr`<html><head></head><body></body></html>`;
    });
    const after = r.renderToString(() => {
      const link = { href: "/after.avif", as: "image", type: "image/avif", crossorigin: "" };
      r.useHead({ tag: "link", props: { rel: "preload", ...link, crossorigin: true } });
      sharedConfig.context.registerAsset("preload", link);
      return r.ssr`<html><head></head><body></body></html>`;
    });

    expect(before.match(/href="\/before\.avif"/g)).toHaveLength(1);
    expect(after.match(/href="\/after\.avif"/g)).toHaveLength(1);
  });

  it("warns for request-mode mismatches and rejects invalid descriptors", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let html;
    let warnings;
    try {
      html = r.renderToString(() => {
        const ctx = sharedConfig.context;
        ctx.registerAsset("preload", { href: "/a.woff2", as: "font" });
        ctx.registerAsset("preload", { href: "/a.woff2", as: "font" });
        ctx.registerAsset("preload", { href: "/b.json", as: "fetch" });
        ctx.registerAsset("preload", { href: "/c.woff2", as: "font", crossorigin: "" });
        ctx.registerAsset("preload", "/untyped.bin");
        ctx.registerAsset("preload", { href: "/missing-as.bin" });
        ctx.registerAsset("preload", { href: "/invalid.bin", as: " style " });
        return r.ssr`<html><head></head><body></body></html>`;
      });
    } finally {
      warnings = warn.mock.calls.map(call => String(call[0]));
      warn.mockRestore();
    }

    expect(html).not.toContain("untyped.bin");
    expect(html).not.toContain("missing-as.bin");
    expect(html).not.toContain("invalid.bin");
    expect(warnings).toHaveLength(5);
    const corsWarnings = warnings.filter(message => message.includes("crossorigin"));
    expect(corsWarnings).toHaveLength(2);
  });

  it("writes a link registered after the shell to the document stream", async () => {
    let done;
    const html = await pipeToString(
      r.renderToStream(() => {
        const ctx = sharedConfig.context;
        done = ctx.registerFragment("late-document-link");
        setTimeout(() => {
          ctx.registerAsset("preload", {
            href: "/late-document.woff2",
            as: "font",
            type: "font/woff2",
            crossorigin: ""
          });
          done("<span>done</span>");
        }, 10);
        return r.ssr`<div><template id="pl-late-document-link"></template><!--pl-late-document-link--></div>`;
      })
    );

    expect(html).toContain(
      '<link rel="preload" href="/late-document.woff2" as="font" type="font/woff2" crossorigin="">'
    );
  });

  it("keeps typed links separate in custom sinks and streams late links", async () => {
    const shells = [];
    const late = [];
    let done;
    const html = await pipeToString(
      r.renderToStream(
        () => {
          const ctx = sharedConfig.context;
          ctx.registerAsset("module", "/entry.js");
          ctx.registerAsset("preload", { href: "/hero.webp", as: "image" });
          done = ctx.registerFragment("late");
          setTimeout(() => {
            ctx.registerAsset("preload", {
              href: "/late.woff2",
              as: "font",
              type: "font/woff2",
              crossorigin: ""
            });
            done("<span>done</span>");
          }, 10);
          return r.ssr`<div><template id="pl-late"></template><!--pl-late--></div>`;
        },
        {
          sink: {
            shell: (value, meta) => shells.push([value, meta]),
            asset: (type, value) => late.push([type, value])
          }
        }
      )
    );

    const meta = shells[0][1];
    expect([...meta.preloads]).toEqual(["/entry.js"]);
    expect(meta.preloadLinks[0]).toEqual(
      expect.objectContaining({ href: "/hero.webp", attrs: { as: "image" } })
    );
    expect(late).toEqual([
      [
        "preload",
        expect.objectContaining({
          href: "/late.woff2",
          attrs: { as: "font", type: "font/woff2", crossorigin: "" }
        })
      ]
    ]);
    expect(html).not.toContain("/hero.webp");
    expect(html).not.toContain("/late.woff2");
  });

  it("carries shell and late links through frame asset chunks", async () => {
    const chunks = await renderToFrameStream(
      () => {
        const ctx = sharedConfig.context;
        ctx.registerAsset("preload", {
          href: "/font.woff2",
          as: "font",
          type: "font/woff2",
          crossorigin: ""
        });
        ctx.registerAsset("preload", { href: "/critical.js", as: "script" });
        ctx.registerAsset("preload", { href: "/critical.css", as: "style" });
        return r.ssr`<div>app</div>`;
      },
      {
        frame: { id: "links", version: 1 },
        nonce: { script: "script-nonce", style: "style-nonce" }
      }
    );

    expect(chunks.find(chunk => chunk.type === "assets").preloads).toEqual([
      {
        href: "/font.woff2",
        attrs: { as: "font", type: "font/woff2", crossorigin: "" }
      },
      { href: "/critical.js", attrs: { as: "script", nonce: "script-nonce" } },
      { href: "/critical.css", attrs: { as: "style", nonce: "style-nonce" } }
    ]);

    let done;
    const late = [];
    await new Promise(resolve => {
      renderToFrameStream(
        () => {
          const ctx = sharedConfig.context;
          done = ctx.registerFragment("late-frame-link");
          return r.ssr`<div><template id="pl-late-frame-link"></template><!--pl-late-frame-link--></div>`;
        },
        { frame: { id: "late-links", version: 1 } }
      ).pipe({
        write(chunk) {
          late.push(chunk);
          if (chunk.type === "html") {
            setTimeout(() => {
              sharedConfig.context.registerAsset("preload", {
                href: "/late-frame.webp",
                as: "image",
                fetchpriority: "high"
              });
              done("<span>done</span>");
            }, 0);
          }
        },
        end: resolve
      });
    });
    expect(late.filter(chunk => chunk.type === "assets")).toEqual([
      {
        type: "assets",
        id: "late-links",
        version: 1,
        key: "",
        preloads: [{ href: "/late-frame.webp", attrs: { as: "image", fetchpriority: "high" } }]
      }
    ]);
  });
});
