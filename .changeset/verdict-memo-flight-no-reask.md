---
"@solidjs/signals": patch
---

An async memo that reads a memo using `latest()` or `isPending()` no longer asks the same question twice. Reading such a memo made the async memo a verdict reader too (F-6). So it was re-derived each time one of its verdict sources went pending, and it was served committed values that a hold had already moved past. Each time, it asked a question it had already answered. With two verdict sources, it could ask a stale question after both had landed. An async memo that opens no `isPending()` or `latest()` window of its own now takes no verdict role. It waits on its sources like any other derivation and asks each question once. Sync memos are unchanged.

A reader that groups `isPending()` with the value over a held write, such as `[isPending(m1), m1()]`, now shows the lane's answer as a plain value reader does. Two things kept it from doing so. A pass that was served a held memo's committed value still waited on that memo's flight, so it never woke when the source it was really pending on settled. And a lane's reveal cleared the stale-reader mark that the held transaction's landing needed in order to re-run it.
