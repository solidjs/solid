---
"@solidjs/signals": patch
---

Size audit (measurement branch): §41 benchmark fixes. A derived store's family settle walk runs only after a wake (`fam.woke`), not on every sync commit — a 1k-row derived store's no-op re-derive was walking every leaf (14× the fork). A value read under a staging asks only whether the key's value or presence changed (`readSource(target, key, shape)`); descriptor readers and hold decisions keep the full enumerability/accessor test, as does any container with accessors seen. Keyed reconcile of 1k rows read by `mapArray` in the staging flush: 2.5× faster.
