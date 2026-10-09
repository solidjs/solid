---
"@solidjs/web": patch
---

Fix an unbounded request loop when a server component's re-asked flight fails the same way as the error it replaces. The server writes an escaped render failure as its message string, so two flights that fail alike carry equal payloads; a mount's content node told "already surfaced" from "the next flight's error" by the payload and re-asked on every flight instead of surfacing the error. It now keys a surfaced error by the response version that carried it: `reset()`, and a fresh mount over an errored address (e.g. after a hover preload that failed), make one request and the error reaches the nearest `<Errored>` again.
