---
"@solidjs/signals": patch
---

A derived store heals with its Errored like the memo it derives from (#4451). A leaf born from a lane container's staging — a derive's lane-pass write to a key nobody had read yet — takes the staging as the lane's derivation, as the write would have left a leaf that existed then; before, the leaf was born a plain staging the park held with the frame, and an Errored the memo's lane value healed stayed on its fallback over the store.
