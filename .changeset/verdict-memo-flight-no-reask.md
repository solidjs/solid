---
"@solidjs/signals": patch
---

An async memo that reads a memo using `latest()` or `isPending()` no longer asks the same question twice. Reading such a memo made the async memo a verdict reader too (F-6). So it was re-derived each time one of its verdict sources went pending, and it was served committed values that a hold had already moved past. Each time, it asked a question it had already answered. With two verdict sources, it could ask a stale question after both had landed. An async memo that opens no `isPending()` or `latest()` window of its own now takes no verdict role. It waits on its sources like any other derivation and asks each question once. Sync memos are unchanged.
