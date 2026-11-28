---
"@solidjs/signals": patch
---

A tracked `isPending()` probe of an optimistic value now reads `true` while the request for a changed input is out under a guess (#5255). This wake runs the current probes of that value. The screen stays held, `latest()`-only readers keep their existing work, and a bare `refresh()` stays quiet.

An async memo that directly probes the guess can request again on each input change, even while `isPending()` stays `true`.
