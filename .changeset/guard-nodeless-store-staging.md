---
"@solidjs/signals": patch
---

Prevent an untracked staged-store read beside `latest()` from throwing and halting reactivity when the store has no reactive node. A pass whose verdict posture is only inherited is now served the hold's own write from a node-less store key, as it is from a signal or a key with a node, so the landing frame no longer tears.
