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
          {
            href: "hero.avif",
            as: "image",
            type: "image/avif",
            fetchpriority: "high",
            imagesrcset: "/cdn/hero.avif 1x, /cdn/hero@2x.avif 2x",
            imagesizes: "50vw"
          },
          {
            as: "image",
            imagesrcset: "/cdn/hero-400.avif 400w, /cdn/hero-800.avif 800w",
            imagesizes: "100vw"
          }
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
      {
        href: "/assets/hero.avif",
        as: "image",
        type: "image/avif",
        fetchpriority: "high",
        imagesrcset: "/cdn/hero.avif 1x, /cdn/hero@2x.avif 2x",
        imagesizes: "50vw"
      },
      {
        as: "image",
        imagesrcset: "/cdn/hero-400.avif 400w, /cdn/hero-800.avif 800w",
        imagesizes: "100vw"
      },
      {
        href: "/assets/fonts/app.woff2?v=1",
        as: "font",
        type: "font/woff2",
        crossorigin: ""
      }
    ]);
    expect(html).toContain(
      '<link rel="preload" href="/assets/hero.avif" as="image" type="image/avif" fetchpriority="high" imagesrcset="/cdn/hero.avif 1x, /cdn/hero@2x.avif 2x" imagesizes="50vw">'
    );
    expect(html).toContain(
      '<link rel="preload" as="image" imagesrcset="/cdn/hero-400.avif 400w, /cdn/hero-800.avif 800w" imagesizes="100vw">'
    );
    expect(html).toContain(
      '<link rel="preload" href="/assets/fonts/app.woff2?v=1" as="font" type="font/woff2" crossorigin="">'
    );
    expect(html).not.toContain("hidden.webp");
    expect(html).not.toContain("not-automatically-preloaded.png");
    resolved.preloads[1].imagesizes = "50vw";
    expect(manifest["app.tsx"].preloads[2].imagesizes).toBe("100vw");
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
        media: "(min-width: 60rem)",
        imagesrcset: "/hero.avif 1x, /hero@2x.avif 2x",
        imagesizes: "50vw"
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
    expect(image).toContain('imagesrcset="/hero.avif 1x, /hero@2x.avif 2x"');
    expect(image).toContain('imagesizes="50vw"');
    expect(image).not.toContain("nonce");
    expect(html.match(/crossorigin=""/g)).toHaveLength(1);
    expect(html).not.toContain("sha384-conflict");
  });

  it("renders and dedupes responsive image preloads without href", () => {
    const link = {
      as: "image",
      imagesrcset: '/hero-small.avif 480w, /hero-large.avif?crop="wide" 960w',
      imagesizes: "100vw"
    };
    const other = {
      ...link,
      imagesrcset: "/other-small.avif 480w, /other-large.avif 960w"
    };
    const html = r.renderToString(() => {
      const ctx = sharedConfig.context;
      ctx.registerAsset("preload", link);
      ctx.registerAsset("preload", link);
      r.useHead({ tag: "link", props: { rel: "preload", ...link } });
      ctx.registerAsset("preload", { ...link, href: "/hero-fallback.avif" });
      r.useHead({ tag: "link", props: { rel: "preload", ...other } });
      ctx.registerAsset("preload", other);
      return r.ssr`<html><head></head><body></body></html>`;
    });

    expect(html.match(/imagesrcset=/g)).toHaveLength(3);
    expect(html).toContain(
      '<link rel="preload" as="image" imagesrcset="/hero-small.avif 480w, /hero-large.avif?crop=&quot;wide&quot; 960w" imagesizes="100vw">'
    );
    expect(html).toContain(
      '<link rel="preload" href="/hero-fallback.avif" as="image" imagesrcset="/hero-small.avif 480w, /hero-large.avif?crop=&quot;wide&quot; 960w" imagesizes="100vw">'
    );
    expect(html).toContain(
      'imagesrcset="/other-small.avif 480w, /other-large.avif 960w" imagesizes="100vw"'
    );
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

  it("keeps a link whose responsive attributes are empty rather than absent", () => {
    // An integration emitting `imagesrcset: srcsetFor(file)` gets "" for
    // everything that is not an image; that must not drop its script,
    // style and font preloads.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const html = r.renderToString(() => {
      const ctx = sharedConfig.context;
      ctx.registerAsset("preload", { href: "/app.js", as: "script", imagesrcset: "" });
      ctx.registerAsset("preload", { href: "/app.css", as: "style", imagesizes: "" });
      ctx.registerAsset("preload", {
        href: "/f.woff2",
        as: "font",
        crossorigin: "",
        imagesrcset: 0
      });
      return r.ssr`<html><head></head><body></body></html>`;
    });
    warn.mockRestore();

    expect(html).toContain('<link rel="preload" href="/app.js" as="script">');
    expect(html).toContain('<link rel="preload" href="/app.css" as="style">');
    expect(html).toContain('<link rel="preload" href="/f.woff2" as="font" crossorigin="">');
    expect(html).not.toContain("imagesrcset");
    expect(html).not.toContain("imagesizes");
  });

  it("canonicalizes destinations and filtered responsive qualifiers", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const html = r.renderToString(() => {
      const ctx = sharedConfig.context;
      ctx.registerAsset("preload", { href: "/x.avif", as: "image" });
      r.useHead({
        tag: "link",
        props: {
          rel: "preload",
          href: "/x.avif",
          as: "IMAGE",
          imagesrcset: "",
          imagesizes: ""
        }
      });
      return r.ssr`<html><head></head><body></body></html>`;
    });
    warn.mockRestore();

    expect(html.match(/rel="preload"/g)).toHaveLength(1);
    expect(html).not.toContain("imagesrcset");
  });

  it("warns when srcset candidates cannot resolve against the manifest base", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    r.renderToString(() => r.ssr`<html><head></head><body></body></html>`, {
      manifest: {
        _base: "/assets/",
        "app.tsx": {
          file: "app.js",
          isEntry: true,
          preloads: [
            // Relative: `_base` joins href but never srcset candidates.
            { as: "image", imagesrcset: "hero.avif 1x, hero@2x.avif 2x" },
            { as: "image", imagesrcset: "/cdn/a.avif 1x" },
            { as: "image", imagesrcset: "https://cdn.example/b.avif 1x" }
          ]
        }
      }
    });
    const warnings = warn.mock.calls.map(call => String(call[0]));
    warn.mockRestore();

    const baseWarnings = warnings.filter(m => m.includes("manifest base"));
    expect(baseWarnings).toHaveLength(1);
  });

  it("reports a relative candidate with no manifest base, and spares commas in URLs", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    r.renderToString(() => r.ssr`<html><head></head><body></body></html>`, {
      manifest: {
        // No `_base`: joinAssetPath still answers "/hero.avif" while the
        // candidate resolves against the document URL, so the asymmetry the
        // warning exists for is present exactly as it is with a real base.
        "app.tsx": {
          file: "app.js",
          isEntry: true,
          preloads: [
            { href: "hero.avif", as: "image", imagesrcset: "hero.avif 400w", imagesizes: "50vw" },
            // Commas inside a candidate URL are part of the URL, not
            // separators — the shape Cloudinary/imgproxy/Fastly IO emit.
            {
              as: "image",
              imagesrcset: "https://cdn.example/w,400/a.avif 400w, /local/w,800/b.avif 800w",
              imagesizes: "50vw"
            },
            { as: "image", imagesrcset: "/cdn/c-1x.avif, /cdn/c-2x.avif 2x" }
          ]
        }
      }
    });
    const warnings = warn.mock.calls.map(call => String(call[0]));
    warn.mockRestore();

    expect(warnings.filter(m => m.includes("manifest base"))).toHaveLength(1);
  });

  it("drops an unusable href from a source-set entry instead of the entry", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let resolved;
    r.renderToString(
      () => {
        resolved = sharedConfig.context.resolveAssets("app.tsx");
        return r.ssr`<html><head></head><body></body></html>`;
      },
      {
        manifest: {
          "app.tsx": {
            file: "app.js",
            preloads: [
              { href: "", as: "image", imagesrcset: "/a.avif 1x" },
              { href: null, as: "image", imagesrcset: "/b.avif 1x" },
              { href: 5, as: "image", imagesrcset: "/c.avif 1x" }
            ]
          }
        }
      }
    );
    warn.mockRestore();

    // `ResolvedAssets.preloads` types href as a string; a bad one is omitted
    // rather than taking a working source-set link down with it.
    expect(resolved.preloads).toHaveLength(3);
    for (const link of resolved.preloads) expect("href" in link).toBe(false);
    expect(resolved.preloads[0].imagesrcset).toBe("/a.avif 1x");
  });

  it("warns for a non-string responsive attribute on an image link", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    r.renderToString(() => {
      sharedConfig.context.registerAsset("preload", {
        href: "/a.avif",
        as: "image",
        imagesrcset: 42
      });
      return r.ssr`<html><head></head><body></body></html>`;
    });
    const warnings = warn.mock.calls.map(call => String(call[0]));
    warn.mockRestore();

    expect(warnings.filter(m => m.includes("string imagesrcset"))).toHaveLength(1);
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
        ctx.registerAsset("preload", {
          href: "/script.js",
          as: "script",
          imagesrcset: "/script-2x.js 2x"
        });
        ctx.registerAsset("preload", {
          href: "/style.css",
          as: "style",
          imagesizes: "100vw"
        });
        ctx.registerAsset("preload", { href: "", as: "image", imagesrcset: "" });
        return r.ssr`<html><head></head><body></body></html>`;
      });
    } finally {
      warnings = warn.mock.calls.map(call => String(call[0]));
      warn.mockRestore();
    }

    expect(html).not.toContain("untyped.bin");
    expect(html).not.toContain("missing-as.bin");
    expect(html).not.toContain("invalid.bin");
    // A responsive attribute on a non-image destination is an authoring
    // mistake, not a reason to drop a render-critical preload: the attribute
    // is filtered, the link still ships.
    expect(html).not.toContain("script-2x.js");
    expect(html).not.toContain("imagesizes");
    expect(html).toContain('<link rel="preload" href="/script.js" as="script">');
    expect(html).toContain('<link rel="preload" href="/style.css" as="style">');
    // The last descriptor is wrong twice over — an unusable href AND no
    // surviving source — and says so, rather than reporting only the second.
    expect(warnings).toHaveLength(9);
    const corsWarnings = warnings.filter(message => message.includes("crossorigin"));
    expect(corsWarnings).toHaveLength(2);
  });

  it("drops a link whose only source was a filtered responsive attribute", () => {
    // The destination decides whether a source set is a source at all. Reading
    // `imagesrcset` as one before `as` is known accepted these descriptors and
    // then filtered the attribute away, emitting `<link rel="preload"
    // as="script">` — a link with nothing to fetch.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const html = r.renderToString(() => {
      const ctx = sharedConfig.context;
      ctx.registerAsset("preload", { as: "script", imagesrcset: "/x.js 2x" });
      ctx.registerAsset("preload", { as: "font", imagesrcset: "/f.woff2 1x" });
      ctx.registerAsset("preload", { as: "style", imagesizes: "100vw" });
      // An image keeps the source-set-only form.
      ctx.registerAsset("preload", { as: "image", imagesrcset: "/hero.avif 1x" });
      return r.ssr`<html><head></head><body></body></html>`;
    });
    warn.mockRestore();

    expect(html.match(/rel="preload"/g)).toHaveLength(1);
    expect(html).toContain('<link rel="preload" as="image" imagesrcset="/hero.avif 1x">');
  });

  it("filters non-string responsive values instead of coercing them", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const html = r.renderToString(() => {
      const ctx = sharedConfig.context;
      ctx.registerAsset("preload", {
        href: "/hero.avif",
        as: "image",
        imagesrcset: 42,
        imagesizes: {}
      });
      // Nothing left to fetch once the junk source set is filtered.
      ctx.registerAsset("preload", { as: "image", imagesrcset: 42 });
      return r.ssr`<html><head></head><body></body></html>`;
    });
    const warnings = warn.mock.calls.map(call => String(call[0]));
    warn.mockRestore();

    expect(html).toContain('<link rel="preload" href="/hero.avif" as="image">');
    expect(html).not.toContain("imagesrcset");
    expect(html).not.toContain("[object Object]");
    expect(html.match(/rel="preload"/g)).toHaveLength(1);
    expect(warnings.filter(m => m.includes("string imagesrcset"))).toHaveLength(2);
    expect(warnings.filter(m => m.includes("string imagesizes"))).toHaveLength(1);
  });

  it("warns when a width descriptor ships without imagesizes", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    r.renderToString(() => {
      const ctx = sharedConfig.context;
      ctx.registerAsset("preload", { as: "image", imagesrcset: "/a-400.avif 400w" });
      // Paired, and density-only art direction, are both fine.
      ctx.registerAsset("preload", {
        as: "image",
        imagesrcset: "/b-400.avif 400w",
        imagesizes: "50vw"
      });
      ctx.registerAsset("preload", { as: "image", imagesrcset: "/c-1x.avif, /c-2x.avif 2x" });
      ctx.registerAsset("preload", {
        as: "image",
        imagesrcset: "https://cdn.example/image,400w 1x"
      });
      return r.ssr`<html><head></head><body></body></html>`;
    });
    const warnings = warn.mock.calls.map(call => String(call[0]));
    warn.mockRestore();

    expect(warnings.filter(m => m.includes("width descriptor"))).toHaveLength(1);
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
          ctx.registerAsset("preload", {
            as: "image",
            imagesrcset: "/hero-480.webp 480w, /hero-960.webp 960w",
            imagesizes: "100vw"
          });
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
    expect(meta.preloadLinks[1]).toEqual(
      expect.objectContaining({
        href: undefined,
        attrs: {
          as: "image",
          imagesrcset: "/hero-480.webp 480w, /hero-960.webp 960w",
          imagesizes: "100vw"
        }
      })
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
        ctx.registerAsset("preload", {
          as: "image",
          imagesrcset: "/hero-480.avif 480w, /hero-960.avif 960w",
          imagesizes: "100vw"
        });
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
      { href: "/critical.css", attrs: { as: "style", nonce: "style-nonce" } },
      {
        attrs: {
          as: "image",
          imagesrcset: "/hero-480.avif 480w, /hero-960.avif 960w",
          imagesizes: "100vw"
        }
      }
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

  it("treats equivalent CORS spellings as one request", () => {
    // The CORS settings attribute is three states, not a string range: absent,
    // Use Credentials, and Anonymous (every other present value, including an
    // invalid one). Forking on spelling shipped the same font five times.
    const html = r.renderToString(() => {
      const ctx = sharedConfig.context;
      for (const crossorigin of ["", true, "anonymous", "ANONYMOUS", "bogus"])
        ctx.registerAsset("preload", { href: "/f.woff2", as: "font", crossorigin });
      for (const crossorigin of ["use-credentials", "USE-CREDENTIALS"])
        ctx.registerAsset("preload", { href: "/f.woff2", as: "font", crossorigin });
      ctx.registerAsset("preload", { href: "/f.woff2", as: "font" });
      return r.ssr`<html><head></head><body></body></html>`;
    });

    // Anonymous, Use Credentials, No CORS — three requests, three links.
    expect(html.match(/rel="preload"/g)).toHaveLength(3);
    expect(html).toContain('<link rel="preload" href="/f.woff2" as="font" crossorigin="">');
    expect(html).toContain(
      '<link rel="preload" href="/f.woff2" as="font" crossorigin="use-credentials">'
    );
    expect(html).toContain('<link rel="preload" href="/f.woff2" as="font">');
  });

  it("treats a falsy conditional qualifier as an absent one", () => {
    // `crossorigin={cond && "anonymous"}` is an everyday JSX idiom; both
    // attribute writers drop `false`, so the identity must too or the same
    // link ships twice with byte-identical markup.
    const html = r.renderToString(() => {
      sharedConfig.context.registerAsset("preload", { href: "/y.avif", as: "image" });
      r.useHead({
        tag: "link",
        props: { rel: "preload", href: "/y.avif", as: "image", crossorigin: false, media: false }
      });
      return r.ssr`<html><head></head><body></body></html>`;
    });

    expect(html.match(/rel="preload"/g)).toHaveLength(1);
  });

  it("keeps qualifier values from forging one another", () => {
    // `:q=value` concatenation let a value carrying the delimiters look like a
    // different qualifier set, which silently dropped the second resource.
    const html = r.renderToString(() => {
      const ctx = sharedConfig.context;
      ctx.registerAsset("preload", { href: "/x.avif", as: "image", type: "a:media=b" });
      ctx.registerAsset("preload", { href: "/x.avif", as: "image", type: "a", media: "b" });
      return r.ssr`<html><head></head><body></body></html>`;
    });

    expect(html.match(/rel="preload"/g)).toHaveLength(2);
  });

  it("keeps URLs from forging qualifier fields", () => {
    const html = r.renderToString(() => {
      r.useHead({
        tag: "link",
        props: { rel: "stylesheet", href: "/loader:type=8:text/css" }
      });
      r.useHead({
        tag: "link",
        props: { rel: "stylesheet", href: "/loader", type: "text/css" }
      });
      return r.ssr`<html><head></head><body></body></html>`;
    });

    expect(html.match(/rel="stylesheet"/g)).toHaveLength(2);
  });
});
