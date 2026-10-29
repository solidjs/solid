---
"@solidjs/signals": patch
---

A memo whose own error came from a pass over a held write no longer shows the Errored fallback for a moment when the hold lands. The landing re-derives the memo before the held effects run, as it already did for a render effect reading the same thing inline (#4407).
