---
"@solidjs/web": patch
---
Address server function calls by path: `<endpoint>/<id>`, with arguments staying in the query.

The id travelled in `X-Server-Function-Id`, with `?id=` as the fallback for requests the client runtime did not make. Both are gone; it moves into the path — what per-function edge rules, cache policies and `http.route` labels key on — leaving one place in the request that carries it, so a cache in front of the app cannot be made to store one function's response under another's key (#3070). POST addresses move too, and `endpoint` now gates dispatch on both halves: a request whose path does not start with it is not a call.

`serverFunctionUrl(id, boundArgs?)` and `parseServerFunctionUrl(url)` ship on both entries for integrations composing action urls. A GET call whose url would exceed 2000 characters dispatches over POST instead, marked as a read — a cache miss rather than a 414.
