---
"@solidjs/signals": patch
---

`isPending()` inside a pass a hold runs is final in that hold's frame: an untracked probe there still reads the committed value, never answers `true` beside the fresh value the pass's plain read saw, and the pass re-derives on the landed world — whether it was re-run while the hold was up, first read the held node in a later flush, or probed only in the flush that staged the write. A probe of a first value staged in the current flush (a narrowed `<Show>`/`<Match>` accessor in its landing flush) reads that value, as its plain read does, instead of `undefined` (#4648).
