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

const responsiveWithFallback: PreloadLink = {
  href: "/hero.avif",
  as: "image",
  imagesrcset: "/hero.avif 1x, /hero@2x.avif 2x",
  imagesizes: "50vw"
};
const responsiveWithoutFallback: PreloadLink = {
  as: "image",
  imagesrcset: "/hero-400.avif 400w, /hero-800.avif 800w",
  imagesizes: "100vw"
};
void responsiveWithFallback;
void responsiveWithoutFallback;

// @ts-expect-error href or imagesrcset is required
const missingSource: PreloadLink = { as: "image" };
// @ts-expect-error only HTML preload destinations are accepted
const invalidDestination: PreloadLink = { href: "/movie.mp4", as: "video" };
// @ts-expect-error arbitrary priorities are rejected
const invalidPriority: PreloadLink = { href: "/hero.avif", as: "image", fetchpriority: "urgent" };
// @ts-expect-error responsive image attributes require as="image"
const invalidResponsiveDestination: PreloadLink = {
  href: "/app.js",
  as: "script",
  imagesrcset: "/app@2x.js 2x"
};
void missingSource;
void invalidDestination;
void invalidPriority;
void invalidResponsiveDestination;
