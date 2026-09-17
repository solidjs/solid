---
"@solidjs/web": patch
"@solidjs/signals": patch
---

Trim per-node work on the hydration claim path. `gatherHydratable` asks once whether the root contains frame regions and tests containment against that list, instead of walking every keyed node's ancestor chain with `closest("[data-fid]")`; `insert()` builds a parent's claim array in one indexed pass over `childNodes` that drops separators as it copies, instead of an iterator spread followed by a compacting pass; and `clearSnapshots` assigns `undefined` to the extension's `_snapshotValue` rather than `delete`-ing it, which pushed every hydrated source's extension object into dictionary mode.
