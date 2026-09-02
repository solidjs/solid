---
"@solidjs/web": patch
---

Judge decoded arguments, guarded results and navigation targets by what they
are rather than by how they are spelled, and never forward a `Content-Length`
that describes a body the transport replaced.

Seven defects, five of them introduced by the guards added in #3168, #3170,
#3175 and #3176. Each fix removes a special case rather than adding one: the
argument walk stops for no prototype, the guard shell keeps only the flag that
reaches the wire, the scheme floor asks the URL parser instead of a regex, and
the event is awaited only when it is genuinely a promise.

Runtime-composed SSR responses now discard stale body-framing headers, and
late streaming redirects emit client script only for relative or HTTP(S)
targets.
