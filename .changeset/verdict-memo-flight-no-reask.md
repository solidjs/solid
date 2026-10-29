---
"@solidjs/signals": patch
---

An async memo that reads a memo using `latest()` or `isPending()` no longer asks the same question again when that memo re-asks. Reading such a memo makes the reader a verdict reader too (F-6), and a verdict reader is re-derived when its source goes pending. The re-derive was served the committed value that the memo had already derived from, so it repeated the request. That extra flight then held the verdict lane, and the landing ran it a third time on the same input. Now an async reader that opened no `isPending()` or `latest()` window of its own goes pending with the flight, like any other derivation, and asks once when the flight lands. Sync readers re-derive as before.
