---
"solid-js": patch
"@solidjs/web": patch
---

Unified For ships default-on through For's own module graph: the slot algorithm (chain + LIS structural updates, flat-mode mounts) lives in solid-js client and travels on the `$for.impl` descriptor For stamps; web's insert engages it by handing over its SlotOps singleton. Zero user API, zero compiler involvement, exact pay-for-use — apps without For tree-shake the slot entirely (~2.1 KB in For-bearing bundles, +153 B engagement seam on the web floor). Renderers that ignore `$for` keep classic mapArray; universal adoption is passing its own ops. enableUnifiedFor and the registration seam are deleted.
