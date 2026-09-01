---
"@solidjs/web": patch
---

Enforce the `Location`/`X-Revalidate` bounds at the transport edge (#3158). `redirect()` and the revalidate helpers refuse over-long values, but a hand-built `Response` reached the wire unchecked — a ~1 MB `Location` became a ~1 MB redirect header, to die at the proxy after the mutation committed. The bound is now a property of the transport, one check where the composed headers leave for every producer; the helpers' authoring-time throws remain the legible fast path. Refused, never trimmed: a cut target is a different address, a dropped revalidate key is a silently stale cache.
