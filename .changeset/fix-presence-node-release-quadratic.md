---
"@solidjs/signals": patch
---

Releasing a target's last presence node drops its presence dictionary with a counter instead of walking every remaining key on each release, so disposing an observer that iterated a store array is linear in the array's length again (#5120).
