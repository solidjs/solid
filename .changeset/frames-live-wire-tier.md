---
"@solidjs/web": patch
---

frames: the live wire moves into a lazy tier (`@solidjs/web/frames/wire`, the sixth chunk). The connection a `live()` loop's response runs under — the open-frame count its end is judged by (a death with frames open vs a completion), the join of a second loop onto an address already live, the supersession cancel, `connection.ended` / `cancel` — the have-list ledger per mount with its encoder, and the resume shape (`Last-Event-ID` + `X-Frame-Have`) load with the chunk. The eager client keeps the arm that awaits the tier's residency before a live response's body is read, so a live connection without the chunk cannot happen; the chunk's import starts at the `live()` call, before its first fetch (preload-at-call, through the new optional `responseHandler.onLive()` hook the sf client fires), and a non-live call never loads it. One accepted degraded case: content applied before the chunk was resident kept no ledger, so that first connect sends no have-list (and no ordinal) and receives a full snapshot.

Public surface: `Frame.have?()` is removed from the `Frame` interface (the ledger is the tier's `haveOf(frame)`, `@internal`); `encodeHaveList` moves from `frame-transport` into the tier (`@internal`; `decodeHaveList` and the `FRAME_HAVE_*` constants stay); the `@solidjs/web/frames/wire` export path is added; `ServerFunctionsClientConfig.responseHandler` gains the optional `onLive()`; `ServerComponentHandler` gains `onLive()`.

Pins: `consistency/tier-wire-preload.spec` and `server-functions-live-loop.spec` — the latter drives `live()`'s reconnect loop from the consumer's side (first-connect failure, the fail-fast 4xx set and 408 / 425 / 429 / `Retry-After`, the cursor as `Last-Event-ID`, the `online` wake, `return()` and a caller's signal at every phase, `live(GET(fn))`, the handler's local answers), closing the loop's branch-coverage gap.

Size: frames eager −965 min / −305 br (10.89 KB); pages −349 / −335 br eager; the `wire.js` chunk 1,922 / 934 (lazy; the live page loads it at its first `live()` call). Caps ratcheted to measured + 10 B.
