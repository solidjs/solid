---
"@solidjs/signals": patch
---

Reader seat S1, floor lever (b): the plain rows of the slot table fire their mechanisms directly (the join, the staging read, the stale reader, the late linker, the link) and return the slot alone; the packed-result convention and its applier stay with the engine rows (lanes.ts `applyMarks`). The hydration claim is a table slot (`claim`, `SLOT_SNAPSHOT`), and `snapshotCaptureActive` moves to the scheduler module so a build without hydration folds the claim arms. No public API change.
