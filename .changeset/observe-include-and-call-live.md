---
"@solidjs/signals": patch
"@solidjs/web": patch
---

Observe tier: `OBSERVE.include(owner)` and a body viewer's `"call"` record.

- `OBSERVE.include(owner)` re-admits an owner subtree under an excluded one; `isExcluded` answers by the nearest marked ancestor, so an observer that renders the app inside its own shell (`<DevToolbar><App /></DevToolbar>`) can hide its chrome and still see the app.
- The `"call"` record's `live.request` is the request as dispatched (final url and `RequestInit`, `prepareRequest` applied), built into a `Request` of the listener's own — without the body when it was a streaming upload; `live.response` is now an unread `clone()` taken before the transport's decode (an event-stream response stays the transport's own object); `CallEvent.name` carries the reference's source name when the build seeded one.
