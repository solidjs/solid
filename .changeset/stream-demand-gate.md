---
"@solidjs/web": patch
---

Pull a streamed server-function result behind a demand gate (#3118). The
response stream was built with no `pull` and no queuing strategy, and
every codec node is enqueued the moment it is parsed, so the producer ran
as fast as it could resolve whether or not anyone was reading: one slow
consumer buffered the whole result in server memory, unbounded and
invisible to application code. The consumer's reads now drive `pull`,
which releases one source pull at a time, so an unread stream stays near
the queue size instead of running away.

Scope: the gate sits on the source the runtime wraps, which is the
result itself. An async iterable nested inside the result — `{ items:
rows() }` — is pumped by the codec directly and is not yet gated. Ending
the stream releases a parked pull, so an aborted, cancelled or failed
stream still closes its source; a consumer that abandons a stream without
cancelling it now leaves the producer parked rather than running it to
completion.
