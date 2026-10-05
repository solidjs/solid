---
"@solidjs/signals": patch
---

`UNSTABLE_MEMO_OUTPUT` compares symbol-keyed properties too, so a memo returning a fresh symbol-keyed box each run (as `dynamic` does for an in-flight promise) is no longer reported as new-but-equivalent.
