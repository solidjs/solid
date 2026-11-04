---
"@solidjs/signals": patch
---

Prevent an untracked staged-store read beside `latest()` from throwing and halting reactivity when the store has no reactive node.
