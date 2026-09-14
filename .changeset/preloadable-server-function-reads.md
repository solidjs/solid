---
"@solidjs/web": patch
---

GET-encoded server function calls no longer send the `X-Server-Function-Instance` header (#3406). A `<link rel="preload" as="fetch">` is reused only by a fetch that matches it exactly, headers included, so the per-call header made browsers fetch every preloaded read twice. A read's identity is now its url alone; the instance id keeps riding the POST transport, where it still names the call to the handler's hooks as `context.instance` (null for reads, as for no-JS callers). `prepareRequest` validation adapts: on a GET call the method the transport set stands sentinel for a returned init that dropped the original.
