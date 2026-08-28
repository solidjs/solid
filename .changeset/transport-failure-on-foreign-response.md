---
"@solidjs/web": patch
---

Fail a server function call on a response the runtime did not write, instead of resolving it to `undefined` (#3087).

Only the protocol's error header and a 5xx counted as failure, so every other non-2xx was decoded as a result — and decoding a login page, or an empty 405, yields nothing. A response at 300 or above carrying neither the error header nor a body format now fails the call with the status on the error, undecoded, and before the passthrough control flow uses: a foreign refusal carries a `Location` of its own often enough that the passthrough would have swallowed it, and the runtime never puts a redirect on the wire as a 3xx.

`BodyFormat.Void` marks the one response the runtime encodes without a format to carry — a function that returned nothing — so `respond(undefined, { status: 400 })` stays a result alongside `new Response(null, { status: 404 })` and `respond(value, { status: 400 })`. A client that predates the tag decodes it the same way; a client that has it, talking to a server that does not, reads an untagged void 4xx as a refusal.

A 2xx is not judged at all: a login page served at 200 is indistinguishable from a void result by header alone. One runtime-produced shape is caught with the foreign ones — a verbatim `X-Content-Raw` response at a non-2xx status, which an integration's `responseHandler` claims before the check.
