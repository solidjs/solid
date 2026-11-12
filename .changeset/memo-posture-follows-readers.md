---
"@solidjs/signals": patch
---

A memo over `latest()` or `isPending()` that only the screen reads now shows what the same reads inline show (#4776). Once a hold's own work reads it, such as a branch the hold opened or an async derivation, it becomes that hold's work, so the async asks only of the truth (#4778).
