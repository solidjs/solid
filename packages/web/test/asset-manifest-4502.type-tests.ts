// solidjs/solid#4502: a manifest literal that sets `_base` (and the vite
// plugin's `_entry` stamp) must type-check as an `AssetManifest`. The string
// index signature carries those metadata strings, so a read by key is an
// entry only once narrowed. Compile-only — runs under `test-types`
// (tsconfig.test.json). Both the source declaration and the published
// `@solidjs/web` one (the client entry's server mock) are checked.
import type { AssetManifest } from "../src/server.js";
import type { AssetManifest as PublishedAssetManifest } from "@solidjs/web";
import { renderToStream } from "../src/server.js";

// The issue's literal.
const manifest: AssetManifest = {
  _base: "/",
  "src/entry-client.tsx": { file: "assets/entry-client.js", isEntry: true }
};
const published: PublishedAssetManifest = {
  _base: "/",
  "src/entry-client.tsx": { file: "assets/entry-client.js", isEntry: true }
};

// Other `_`-prefixed metadata strings ride the same index signature: the vite
// plugin's `virtual:solid-manifest` stamps `_entry` with the client entry key.
const stamped: AssetManifest = {
  _base: "/assets/",
  _entry: "src/entry-client.tsx",
  "src/entry-client.tsx": {
    file: "entry-client.js",
    css: ["entry-client.css"],
    imports: ["_shared.js"],
    preloads: [{ href: "/font.woff2", as: "font", type: "font/woff2", crossorigin: true }]
  },
  "_shared.js": { file: "shared.js" }
};

// Accepted by the renderer option it exists for.
renderToStream(() => null, { manifest });
renderToStream(() => null, { manifest: published });
renderToStream(() => null, { manifest: stamped });

// `@solidjs/vite-plugin`'s `ViteManifest` (structural copy, 3.0.0-next.50)
// stays assignable to the renderer option, and so does the shape it can
// move to once this lands (an index signature carrying `_entry`).
type PluginEntry = {
  file: string;
  css?: string[];
  isEntry?: boolean;
  isDynamicEntry?: boolean;
  imports?: string[];
};
type CurrentViteManifest = Record<string, PluginEntry> & { _base?: string; _entry?: string };
type NextViteManifest = {
  [key: string]: PluginEntry | string | undefined;
  _base?: string;
  _entry?: string;
};
declare const currentVite: CurrentViteManifest;
declare const nextVite: NextViteManifest;
currentVite satisfies AssetManifest;
nextVite satisfies AssetManifest;
currentVite satisfies PublishedAssetManifest;
nextVite satisfies PublishedAssetManifest;

// `_base` reads as the base string.
const base: string | undefined = manifest._base;
void base;

// A read by key is an entry once narrowed, and its fields stay typed.
const entry = manifest["src/entry-client.tsx"];
if (entry && typeof entry === "object") {
  entry.file satisfies string;
  entry.isEntry satisfies boolean | undefined;
  entry.css satisfies string[] | undefined;
  entry.imports satisfies string[] | undefined;
}
// @ts-expect-error an un-narrowed read may be a metadata string or absent
manifest["src/entry-client.tsx"].file;

// Entry shapes are still checked.
const missingFile: AssetManifest = {
  // @ts-expect-error an entry needs `file`
  "src/entry-client.tsx": { isEntry: true }
};
const badBase: AssetManifest = {
  // @ts-expect-error `_base` is a string, never an entry
  _base: { file: "x.js" }
};
const badField: AssetManifest = {
  // @ts-expect-error entry fields keep their types
  "src/entry-client.tsx": { file: "entry.js", isEntry: "yes" }
};
void missingFile;
void badBase;
void badField;

export {};
