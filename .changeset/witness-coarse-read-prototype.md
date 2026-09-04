---
"@solidjs/signals": patch
---

Internal coarse-read machinery (no public API): `witnessNext` subscribes one record's deep-witness node and serves the raw backing — the coarse-row read model (zero leaf nodes/links/wrap caches per row), consumed by the compiler-emitted row track, not user code. Deep-witness bumps now bubble to witnessed ancestors (gated by a live-witness counter: unwitnessed apps pay one number check per change), so one witness covers a record subtree. Hand-compiled dbmon rows: mount 0.70x, unmount 0.61x, tick 0.90x vs fine-grained.
