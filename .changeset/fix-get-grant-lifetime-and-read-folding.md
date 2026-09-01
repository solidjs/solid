---
"@solidjs/web": patch
---

Two server-function grant fixes (#3129, #3128). A `GET()` declaration now
dies with the binding it was made about: `registerServerFunction` revokes
the id's declared method when it rebinds the id to a different function,
so a mutation registered onto a once-declared id (an id collision, a
module re-evaluated in a live process after an edit dropped the wrapper)
no longer inherits GET dispatch and the origin-gate exemption — a function
that still declares GET re-runs `GET()` right after re-registering, which
re-arms the grant exactly when it is still meant. And the single-flight
request header is now honored on POST only, the server half of the
client's own rule: folding on a GET would put a second body — an envelope
carrying data computed from that caller's request — at a cacheable url
under whatever public Cache-Control the author wrote, with nothing naming
the variance, one curl away from a shared-cache poisoning.
