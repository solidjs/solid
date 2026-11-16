---
"@solidjs/web": patch
---

A server function called with one argument whose encoding has no bytes (`''`, an empty `URLSearchParams`, `Blob`, `ArrayBuffer` or `Uint8Array`) receives that value when the host passes the request on with no body, as Node adapters do for `Content-Length: 0` (#4939). The format tag says one argument was sent, so the server decodes it from the empty body. Before, the call ran with no arguments: `echo('')` ran as `echo(undefined)`. An untagged empty POST is still a zero-argument call.
