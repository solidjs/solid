---
"solid-js": patch
---

Fix `renderToString` exiting the process on a late async rejection (#3570). Every server async flight settles an internal deferred; under `renderToString` (no serialization channel, the sync `<Loading>` path never awaits the pending source), in a `<NoHydration>` zone, or for an unread source, nothing observed it, so an async memo/store/projection that rejected after the HTML was returned became an `unhandledRejection`. The deferred is now observed at creation; consumers see exactly what they saw before.
