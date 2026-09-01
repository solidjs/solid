---
"@solidjs/web": patch
"@solidjs/h": patch
"solid-js": patch
---

Add typed preload links to the server asset pipeline.

Static manifests can attach `preloads: PreloadLink[]`, resolver results can carry the same shape for framework integrations, and any integration can register a link with `registerAsset("preload", link)`. The runtime preserves `as`, MIME type, CORS mode, integrity, referrer policy, fetch priority, and media attributes across string, streaming, embedded-head, custom-sink, and frame renders.

`lazy()` and `clientOnly()` forward resolver-provided preload links alongside their JS and CSS.

`JSX.HTMLPreloadAs` and `JSX.HTMLFetchPriority` are now exported for reuse.

Preload links are explicit: manifest `assets` are not preloaded automatically. Existing stylesheet and modulepreload APIs are unchanged.

Development builds warn when font or fetch preloads omit `crossorigin`, because a different eventual request mode cannot reuse that preload.

Frame clients also retain and consume every late root asset record instead of dropping earlier records that reuse the same transport key.
