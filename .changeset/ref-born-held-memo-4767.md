---
"@solidjs/signals": patch
"solid-js": patch
"@solidjs/web": patch
"@solidjs/universal": patch
---

A ref callback that reads a sync memo on a row mounted while an async memo is in flight no longer leaves that update held forever (#4767). Refs run in the attribute effect's commit half with no owner; a memo born into the hold has only a staged value, and an ownerless read of it threw `NotReadyError` (A19 exception 1), which errored the effect mid-hold so the transaction never landed. `runRefCallback` now marks the read, and `serve` returns the staged value there; production `ref()` always goes through `runRefCallback` so the mark is present outside dev too.
