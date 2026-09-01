---
"@solidjs/signals": patch
---

Close the fourth fold-audit round on the structural version chain: the visible version bumps at emission for every structural emitter — adoption commits eagerly, so every reader's init read includes every emitted walk state, parked windows and ambient mounts alike, deleting the deferred-visibility machinery and the held-queue registration special case entirely (no reader anywhere can replay stashed row ops it already rendered); reveal marks are epoch-stamped and set only on proven emission (a boolean lingered on descendant-retained roots the settle loop never visits, and a no-op fold could suppress the only revert resync a driven list needed); and equal-length primitive permutations classify as structure (classic keys primitive rows by value — reorders move rows instead of rewriting slot contents, preserving identity and focus).
