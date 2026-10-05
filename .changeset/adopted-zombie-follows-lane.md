---
"@solidjs/signals": patch
---

A render effect still on screen while an action holds its removal follows the lane's re-derivation of a memo it reads, as its direct `latest()` twin does (fuzzer adopted-staging case)
