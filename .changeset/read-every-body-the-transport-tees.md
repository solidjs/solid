---
"@solidjs/web": patch
---

Make `extractBody` own the stream it decodes: the body is read where it lies, never from an internal clone. An unread tee branch queues the whole payload in memory for the life of the read and defeats backpressure and cancellation — the same ownership defect fixed for the upload leg in `bufferBodyWithin` (#3217–#3219). `decodeResponse` keeps its documented contract (an integration's response stays readable) by cloning at its own entry — a branch that is then read in full; the client transport decodes the response it owns directly, and the server's argument road reuses its one deliberate clone (kept so `event.request` stays readable) for the empty-body inspection instead of teeing again. This is the clone half of #3244 only; connection teardown on completion is deliberately not included.
