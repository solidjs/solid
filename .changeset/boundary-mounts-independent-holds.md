---
"@solidjs/signals": patch
---

Two mounts under one boundary, made in separate flushes, keep their holds independent (S-5 rows 1′–3′, D-4, #4283). A boundary's tree and output are structure, not a user derivation of its content: like the render effect that flattens the same children without a boundary, they read a hold they are not part of as committed and are re-derived at its landing, and a re-pass of one outside its hold's flush publishes mainline instead of re-joining that hold and merging it with the next flush's. `<Errored>` and `<Loading>` (without `on`) around two `<Show>`s, each over its own hold, now reveal each branch at its own hold's landing. An `on` boundary's output still joins: its re-arm swap is the change's work.
