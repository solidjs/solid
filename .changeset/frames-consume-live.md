---
"@solidjs/web": patch
---

Frames consume `live`: a server component called through `live(fn)` streams as an event-stream frame response (live headers, heartbeat, dev chaos knob) and the reference's loop owns the connection's lifetime — a body ending with the frame open is a death (backoff, reconnect, one morph, no fallback, no remount), `complete` is a completion, supersession from another response cancels the connection so the loop reconnects, and one live connection is held per address. `getServerFunctionInvocation()` reports `live`; `serverComponentResponse` takes `live`. Without a loop, a frame response ending before a started frame's `complete` is now that frame's error.
