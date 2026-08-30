---
"@solidjs/web": patch
---

Warn in dev when a scripted server function call is answered with 304 Not Modified (#3101). The scripted transport sends no conditional headers, so a hand-rolled 304 resolves the call to `undefined` rather than "unchanged" — the warning points at GET-declared reads with ETag/Cache-Control, where the browser owns the conditional exchange and replays its cached answer.
