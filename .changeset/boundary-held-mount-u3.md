---
"@solidjs/signals": patch
---

A Loading boundary mounted by a pass that joined a hold appears at that hold's commit, its fallback never shown (D-13, U-3). Before, the boundary's content was caught as a fresh mount and the fallback published at once (or, for a `<Show>` that opens when a flight lands, flashed at the landing before the content). A first pass born into the flush's hold is now the hold's, not the boundary's: the content reads with the hold and the whole mount appears at its commit. A mount made by a verdict reader (`latest` in a `<Show>`) is still mainline and shows the fallback while the hold is up.
