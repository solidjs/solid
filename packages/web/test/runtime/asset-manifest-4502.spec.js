/**
 * @vitest-environment jsdom
 */
// solidjs/solid#4502: `AssetManifest`'s index signature carries `_`-prefixed
// metadata strings (`_base`, the vite plugin's `_entry`) and admits
// `undefined`, so the renderer narrows every keyed read to an object before
// treating it as an entry.
import * as r from "../../src/server.js";
import { sharedConfig } from "solid-js/internal";
import { describe, expect, it } from "vitest";

const manifest = {
  _base: "/assets/",
  _entry: "app.tsx",
  "app.tsx": { file: "app.js", isEntry: true, css: ["app.css"], imports: ["shared.tsx"] },
  "shared.tsx": { file: "shared.js" }
};

describe("AssetManifest metadata keys (#4502)", () => {
  it("skips metadata values when registering entry assets", () => {
    // Metadata the integration left unset, enumerated before the entry.
    const html = r.renderToString(() => r.ssr`<html><head></head><body></body></html>`, {
      manifest: { _unset: undefined, ...manifest }
    });
    expect(html).toContain('href="/assets/app.css"');
    expect(html).toContain('href="/assets/shared.js"');
  });

  it("answers no assets for a metadata key", () => {
    let entry, meta, base;
    r.renderToString(
      () => {
        entry = sharedConfig.context.resolveAssets("app.tsx");
        meta = sharedConfig.context.resolveAssets("_entry");
        base = sharedConfig.context.resolveAssets("_base");
        return r.ssr`<html><head></head><body></body></html>`;
      },
      { manifest }
    );
    expect(entry).toEqual({
      js: ["/assets/app.js", "/assets/shared.js"],
      css: ["/assets/app.css"]
    });
    expect(meta).toBeNull();
    expect(base).toBeNull();
  });
});
