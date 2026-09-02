---
"@solidjs/signals": patch
"@solidjs/babel-plugin-jsx": patch
"solid-js": patch
---

Deep regions bubble on write instead of subscribing witnesses: the emitter's deep flag (`_$region(subject, tracked, body, 1)`) marks the record a refcounted deep-region root, and `bumpDeep` on any descendant walks the parent chain to bump flagged ancestors — one dk subscription per region regardless of read depth, gated on a live-deep-regions counter so stores without deep regions never pay the walk. Replaces the witness-per-intermediate-record design, which measured 2.3x the hand-fixture tick cost on dbmon (six subscriptions re-tracked per rerun). Compiled dbmon tick is now at hand-fixture/driver parity and inside Octane's noise band (2.9 vs 3.1ms same-run); over-delivery on unrelated deep writes is a no-op at the body's baseline compares.
