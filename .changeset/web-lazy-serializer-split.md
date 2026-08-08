---
"@solidjs/web": patch
---

Server-function results negotiate a JSON fast path and the seroval codec
loads lazily. The runtime's shared wire layer now late-loads the codec with a
dynamic import the moment a Serialized body actually has to be encoded or
decoded; since the server answers JSON-safe results (single-flight
`{ value, data }` envelopes included) as plain JSON and void results
body-less, a plain-data app's client bundle carries only the transport
(~2.9 kB gz eager, down from ~7.3) and the codec arrives as a lazily-fetched
chunk only when a rich value — a Date, a Map, a stream, a typed Error —
appears on the wire. The packaging resolves that dynamic import to the public
`@solidjs/web/serialization` entry (these single-file dists cannot
code-split), so the app's bundler splits it at the package boundary and the
lazily-loaded codec is the same module instance custom plugins are authored
against.
