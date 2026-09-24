---
"@solidjs/web": patch
"solid-js": patch
---

Performance tracks: server spans in the browser panel (Stage 5)

Dev and observe servers now write the request's timed work as `Server-Timing` metrics beside the trace entries: `solid-invocation;dur;desc="<id>"` on a server-function response, and `solid-shell;dur` plus one `solid-boundary;dur;desc="<owner path>"` per boundary that waited and settled before the shell on a document. Dev builds always write them; observe builds only while something on the server is subscribed to the `invocation` / `boundary` records (no wire change without an observer); prod builds carry no code. `desc` values are sanitized to printable ASCII (a non-ASCII header value throws from `Headers.append`, which used to be able to hang a response whose first write carried it).

`@solidjs/web/performance-tracks` reads the metrics back: a `call` record's response headers become `<id> · server` spans beneath the call, placed against the resource's `responseStart` (via `PerformanceObserver` for late-arriving entries, centred in the call when none arrives within 30 s), and the document's `PerformanceNavigationTiming.serverTiming` paints `shell · server` / `boundary … · server` when the tracks enable.
