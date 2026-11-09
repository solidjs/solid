---
"@solidjs/signals": patch
---

`isPending()` read untracked inside a pass reads what the pass's plain read does in a normal flush — the flush's staging — so a pass never settles on the old value beside the new one. Inside a hold it still reads the committed value, but it is final in the hold's frame (never `true` beside the fresh value), and the pass re-derives on the landed world before the hold's held runs show, so the hold ends with one frame — whether the pass was re-run while the hold was up, first read the held node in a later flush, or probed only in the flush that staged the write. A probe of a first value staged in the current flush (a narrowed `<Show>`/`<Match>` accessor in its landing flush) reads that value instead of `undefined` (#4648).
