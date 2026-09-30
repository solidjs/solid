---
"@solidjs/signals": patch
---

A lane pass on an effect now releases an older frame's zombies at its tail (it direct-commits ahead of its transaction, like a contested mainline pass) and parks the frame it replaces as a lane frame, retired when the effect's run applies rather than at the action's commit. Fixes a keyed row moved by the second of two overlapping optimistic actions disappearing from the DOM — the first move's lane pass had stamped the `insert` effect for its zombies alone, and the second's refresh re-run disposed the lane's freshly built inner effect and held its replacement for a commit that never came (#3662). A held lane no longer runs the displayed frame's cleanups ahead of the reveal, nor republishes the retired frame under the lane's values after it.
