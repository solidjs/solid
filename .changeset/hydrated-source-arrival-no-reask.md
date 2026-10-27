---
"solid-js": patch
---

A memo that adopted its server answer no longer asks again when the server's answer for one of its sources arrives mid-stream. Hydrated mid-stream, an async shell memo `b` reading another, `a`, re-ran when `a`'s server value landed, and the serialized-value latch took that rerun for a client write and computed `b`. The arrival of a served answer, with the flush that carries it, is now hydration's own pass (as a hydrated failure's content run is): a latched node re-running there re-serves its own answer and arms nothing. Only a client write makes it compute.
