---
"@solidjs/web": patch
---

frames: C4 — the regions tier. Nested server-content regions (`{$frame}` slot args resolved to `<solid-frame>` region elements with frames bound over them) leave the eager frames client for the lazy chunk `@solidjs/web/frames/regions` (a new `@experimental` export path), loaded through the tier mechanism: the server announces `regions` where it mints one; a record naming a region met before the tier is resident waits — a fresh mount in the held set (the frame's hold registered under frames-rulings 3.1 on the adopt path, the server interior on screen), a mounted occurrence's new record pending in the store until the install's flush. `InstallOptions.tiers` now types a tier's module as the new exported `TierModule` (its exports are the tier's appliers; `install()` stays optional). Frames eager −1,078 B minified / −237 B brotli; the page scenarios −1,083 B minified; the non-SC scenarios unchanged.
