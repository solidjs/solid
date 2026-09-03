---
"@solidjs/web": patch
---

Unified For slot: keyed-fn mode (H4 implemented) — keys from the user's `keyed` function, rows on the classic accessor contract (per-row item signal; same-key raw replacements update the signal instead of rebuilding). The shallow-store idiom now gets the slot's structural wins. Internals renamed slot-not-driver (the patch-era driver was push; this is pull).
