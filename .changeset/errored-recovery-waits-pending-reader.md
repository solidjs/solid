---
"@solidjs/signals": patch
---

`<Errored>` no longer recovers beside a memo that is still answering an older input (#4592). While the error fallback shows, a reader behind it that goes pending — which passes the error boundary by (A6) and, hidden, holds nothing — is now also waited on by the boundary, as a pending under a hidden loading fallback already was. When the source that threw answers but another reader in the content is still asking for the new input, the error stays the display until that reader answers too, so the content reveals as one whole frame instead of showing the pending memo's stale value beside the new input (D-39, F-1).
