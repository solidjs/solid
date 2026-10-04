---
"@solidjs/signals": patch
---

Size audit (measurement branch): §41.5 — the container node's escape hatch (Q-A). A store staging gets its container node only when something can read the frame through it: a structural subscriber, lane work, a creation-time pass, or a derive a transaction holds. Otherwise the backing swap and the fold queue are the whole staging — nothing is allocated, queued or swept per container — and when a flush parks, the seam materializes and holds the node for every node-less staging (`_storePark`), so a never-read key of a held container still reads committed until the landing (pinned). The fold queue itself no longer allocates per batch: a reusable list plus a weak map of pre-batch backings written in place (a dbmon tick's ~7000 containers cost ~540 KB of map table per tick before). dbmon-deep tick 1.17–1.19× → 1.08–1.13× by the harness's own method; node parity.
