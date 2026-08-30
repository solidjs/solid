---
"@solidjs/web": patch
---

Pull a streamed server-function result behind a demand gate (#3118). The
response stream was built with no `pull` and no queuing strategy, and
every codec node is enqueued the moment it is parsed, so the producer ran
as fast as it could resolve whether or not anyone was reading: one slow
consumer buffered the whole result in server memory, unbounded and
invisible to application code. The consumer's reads now drive `pull`,
which releases one source pull at a time — measured over 200 idle
event-loop turns, an async generator advanced by one step instead of
running away. Teardown releases a parked pull, so an aborted or cancelled
stream still ends.
