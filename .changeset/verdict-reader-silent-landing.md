---
"@solidjs/signals": patch
---

An `isPending` reader of an async memo settles when the memo's flight lands equal to its committed value: the settle walk re-derives the verdict reader instead of leaving it `true` (fuzzer F9).
