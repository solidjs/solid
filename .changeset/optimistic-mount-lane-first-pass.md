---
"@solidjs/signals": patch
---

A node created by a lane pass is the lane's from the start of its first pass, not only at its end (#3835). A memo mounted by an optimistic write (a `<Show>` over an optimistic signal) used to run its body outside the lane, so the render effects it created read the transaction's staged value and were born held: the lane revealed the memo's element before those effects had run once. They now read the screen like the rest of the lane's frame and run at the reveal. A pending flight reads as it did before for a node with no committed value yet: a memo sees it pending, held or not, so a `Loading` the lane mounts shows its fallback (A29's boundary exemption, #3540), and a render effect is still a stale reader of a held flight (rule 3).
