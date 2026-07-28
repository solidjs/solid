---
"solid-js": patch
---

Fix SSR `createProjection` mishandling replacement values (values returned or yielded that differ from the draft) (#2948). Replacements are now authoritative snapshots on every server path — keys absent from the replacement are deleted instead of retained from the seed, matching the client's replace-mode reconcile. Later async-generator replacement yields are now applied through the patch-recording draft before the batch is drained, so their sets/deletes actually stream to the client instead of emitting an empty patch batch. The client's hydration first-snapshot apply mirrors the same replace semantics for object roots.
