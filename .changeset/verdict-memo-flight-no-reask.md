---
"@solidjs/signals": patch
---

An async memo that reads a memo using `latest()` or `isPending()` no longer asks the same question twice. Reading such a memo makes the async memo a verdict reader too (D-25). It was re-derived each time one of its verdict sources went pending, served a committed value it had already answered, and asked that question again; with two verdict sources it could ask a stale question after both had landed. Such a memo, one that calls neither `latest()` nor `isPending()` itself, now waits on a verdict source going pending like any derivation, and a re-run its hold makes reads plainly as the hold's work. It asks each question once. An async memo that calls `latest()` or `isPending()` itself is unchanged: it stays a verdict reader and shows the lane's answer ahead (F-6).

A reader that groups `isPending()` with the value over a held write, such as `[isPending(m1), m1()]`, now shows the lane's answer as a plain value reader does. A pass served a held memo's committed value no longer waits on that memo's flight, and a lane's reveal leaves the stale-reader mark the held transaction's landing needs to re-run it.
