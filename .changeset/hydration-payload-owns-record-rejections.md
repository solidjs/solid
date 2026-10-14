---
"@solidjs/web": patch
---

The hydration bootstrap marks every promise the inline payload files under `_$HY.r` as handled when it lands, so a serialized async read that rejected under an `<Errored>` (which already rendered its fallback) no longer raises `unhandledrejection` in the browser. A consumer reading the record still receives the rejection.
