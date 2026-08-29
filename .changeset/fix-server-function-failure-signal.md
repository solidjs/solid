---
"@solidjs/web": patch
---

Server-function failure is now signaled by the protocol's error tag alone, and thrown errors answer a real 500 (#3097). The client no longer treats `status >= 500` as failure on responses the runtime encoded — `respond(value, { status: 500 })` resolves with its value like any other returned value, and only a thrown outcome rejects. A peer's own 5xx (proxy, load balancer) carries no body-format header and is still refused before decoding. On the server, a plain thrown error now answers 500 instead of 200-with-tag, so intermediaries — CDN metrics, load-balancer health, log alerts — see what the tag tells the client; thrown envelopes keep the author's status as before.
