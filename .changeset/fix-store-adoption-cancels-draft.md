---
"@solidjs/signals": patch
---

Fix a same-batch store reset leaving subscribers on the cancelled value (#3296). A draft write (`setStore(s => { s.count = 1 })`) notifies its node at setter exit; an adoption in the same batch (`setStore(reconcile(...))` or a returned replacement) discards the draft and diffs the incoming object against the committed backing, so a key the draft changed and the adoption restored never re-notified — untracked reads showed the reset while memos and effects committed the draft value. Adoptions now put every node the discarded draft moved back on committed before the diff runs; the last write wins for every setter form.
