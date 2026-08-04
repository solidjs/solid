---
"@solidjs/web": patch
---

frames: keep waiting for a document boundary whose element is still held by a deferred fragment. `_$HY.done` stopped meaning "the page is complete" once post-done swaps became held-until-claimed (#2964) — a boundary rendering in that window mounted a fresh frame, orphaning the markup the replay then delivered, and left the id unclaimed so every later call resolved back to the document placeholder instead of fetching (a server-component region that never updates again). An unresolved `pl-*` placeholder now keeps the answer "not yet"; a reveal that exhausts the page's deferred fragments releases the waiter to mount fresh.
