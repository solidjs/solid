---
"@solidjs/signals": patch
---

Consolidate patch-channel internals (size pass 2): one held-owner-queue probe, one deferred-run shape for held consumers, shared registration prologue and structural unbind. Behavior-neutral; compressed size unchanged (repetition was already compression-free), raw minified −34 B.
