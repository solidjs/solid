---
"@solidjs/web": patch
---

`renderToStream`: a serialized source that rejects before the shell completes no longer exits the process. Before the shell, `trackSerialized`'s race waits in the stub batch, and seroval subscribes to it only when the batch is flushed. While another fragment is still pending, that flush comes a macrotask later. A source rejecting in between rejected the race with no handler attached, so Node reported an unhandled rejection. Examples are an async memo that throws right away, or a router `query` whose guard refuses the request. The race is now observed where it is created, and seroval still receives the rejection when it subscribes.

The fragment promise `registerFragment` parks in the same batch (`<key>_fr`) had the same exposure: a `<Loading>` whose content throws on a retry pass while the shell is still held — on a pending root hole, or a no-progress timer — rejects its `_fr` promise before anything has subscribed to it, and the process exited the same way. An `<Errored>` outside the boundary does not help pre-shell (the fragment channel owns the error once registered). That promise is now owned where it is created as well; the rejection still reaches the client, and the server error hook still hears it once.
