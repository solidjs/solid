---
"@solidjs/signals": patch
---

A same-key content rewrite on a keyed optimistic list (`return d.map(...)`, or a whole-array setter that patches one row) is now a leaf guess on that row, not a guess on the list. A failed refresh after such a write reaches `<Errored>`, as a field edit already did (#4737). Whole-array and field forms still match under overlapping actions (#4724).
