---
"@solidjs/web": patch
---

`renderToStream`: a serialized source that rejects before the shell completes no longer exits the process. Before the shell, `trackSerialized`'s race waits in the stub batch, and seroval subscribes to it only when the batch is flushed. While another fragment is still pending, that flush comes a macrotask later. A source rejecting in between rejected the race with no handler attached, so Node reported an unhandled rejection. Examples are an async memo that throws right away, or a router `query` whose guard refuses the request. The race is now observed where it is created, and seroval still receives the rejection when it subscribes.
