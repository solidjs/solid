---
"@solidjs/signals": patch
---

A rejection under a `<Loading>` that has not shown its content reaches `<Errored>` at once when a `latest()` reader under the same boundary reads a derivation whose upstream still has a flight out for an older question (#4568). The boundary judged its readers settled while that `latest()` reader was queued to re-derive, revealed into a hold the reader then went pending in, and the later rejection was staged in that hold until the obsolete flight landed. A verdict reader queued to re-derive is now waited on until its pass answers (A19, D-41).
