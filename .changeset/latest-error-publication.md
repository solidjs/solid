---
"@solidjs/signals": patch
---

An error seen through `latest()` now publishes with its reader, as a value would. Inside an open action, an `<Errored>` around `latest(m)`, or around a memo of it, shows `m`'s held error ahead, and later errors and the recovery reach that fallback the same way. Plain readers still wait for the reveal (D-41).
