---
"solid-js": patch
---

Fix `<For>` followed by siblings desyncing hydration (#3161, rc.4 regression). The patch-mode list seam made `For`'s `mapArray` creation lazy, but hydration ids mint at creation time — deferring to first read spent the list's id scope after later siblings had already claimed their template keys, shifting every hydration key after the list and leaving the siblings detached (dead buttons). A hydrating `For` now creates its map eagerly at source position, restoring rc.3 id parity; outside hydration the lazy creation stands.
