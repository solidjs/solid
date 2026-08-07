---
"@solidjs/web": patch
---

`commitEventResponse(response, event?)` is exported from the server entry (with a loud client-side mock, like the other server-only helpers) — handler-lifecycle plumbing completing the response-head choreography's two exits: page results leave through `createSSRResponse`, any other `Response` (a middleware early return, an API result) leaves through `commitEventResponse`; application middleware never calls it. It runs the same fold the server-function handler's responses take — cookies append entry-by-entry, other stub headers gap-fill (minus the protocol-owned family and body metadata on bodiless responses), status never — then commits the stub. Idempotent at handler edges: an already-committed stub (a page response from `createSSRResponse`) passes through untouched, so handlers apply it unconditionally after their middleware chain unwinds. `event` defaults to the ambient `getRequestEvent()`.
