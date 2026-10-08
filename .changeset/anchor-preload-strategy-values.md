---
"@solidjs/web": patch
"@solidjs/h": patch
---

Accept `preload="viewport"` and `preload="eager"` on anchors at the type level. `@solidjs/router` 2.0.0-next.38 added `viewportPreload()` and `eagerPreload()`, which apply to links that name them with those values, but the anchor `preload` attribute was typed `boolean | "false"`, so a router link opting into either strategy needed a `@ts-expect-error`. Its doc comment also described the router's old default preload, which is now opt-in.
