---
"@solidjs/web": patch
---

Defuse the promise the decoder's abort sweep is about to reject (#3267). A `PromiseConstructor` node whose ref id collides with an already-assigned id (or is malformed) throws mid-registration, leaving a `{p, s, f}` deferred in the decoder's refs whose promise `ownDecodedPromises` never claimed — the deferred is not itself a Promise. The end-of-stream sweep then rejected that promise with no owner, and under Node's default policy one unauthenticated POST with a crafted argument body ended the process after the request was already refused 400. The sweep now takes ownership of `.p` before rejecting it, covering every promise it touches regardless of how the entry reached refs.
