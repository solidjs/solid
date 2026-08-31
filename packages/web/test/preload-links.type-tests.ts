import type { AssetManifest, PreloadLink, ResolvedAssets } from "../src/server.js";

const preload: PreloadLink = {
  href: "/font.woff2",
  as: "font",
  type: "font/woff2",
  crossorigin: true,
  fetchpriority: "high",
  referrerpolicy: "no-referrer"
};

const manifest: AssetManifest = {
  entry: { file: "entry.js", preloads: [preload] }
};

const resolved: ResolvedAssets = { js: [], css: [], preloads: [preload] };
void manifest;
void resolved;

// @ts-expect-error href is required until responsive image preloads add a source-only form
const missingHref: PreloadLink = { as: "image" };
// @ts-expect-error only HTML preload destinations are accepted
const invalidDestination: PreloadLink = { href: "/movie.mp4", as: "video" };
// @ts-expect-error arbitrary priorities are rejected
const invalidPriority: PreloadLink = { href: "/hero.avif", as: "image", fetchpriority: "urgent" };
void missingHref;
void invalidDestination;
void invalidPriority;
