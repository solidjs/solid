---
"solid-js": patch
---

`lazy().preload()` now registers the module's client JS/CSS as head hints on the server, not just its import. Registration used to wait for the component to render, so a router warming a matched route imported the module without emitting any `<link>` for it. The import is never gated on asset resolution, the per-request resolution cache is shared with the render path, and `registerModule` stays with the render — its hydration key is only known there.
