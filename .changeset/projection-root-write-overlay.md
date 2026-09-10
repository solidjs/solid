---
"@solidjs/signals": patch
---

Projection and derived-store drafts now open as prototype overlays like plain stores, so a derive that touches one root key of a wide keyed record is O(written) instead of cloning the whole raw on every recompute (#3352: ~17 ms → ~0.02 ms per derive at 20k keys). Optimistic families, chained backings, and arrays keep the clone path. Also fixes an overlay commit bug this surfaced: a child's flatten could resurrect a slot that the parent's earlier fold in the same batch had replaced or deleted.
