---
"@solidjs/web": patch
---

`renderToStream` now reports two failures through the server error hook even when the render has no `onError` of its own (#4193). A value the serializer cannot handle reaches the render's hook, else the one set with `configureServerErrors`, as `{ kind: "render", handling: "serialize" }`, and the render settles. Before, it was an unhandled rejection and the render stayed pending forever. With no hook anywhere, the failure goes to `console.error`. An `onCleanup` that throws when the render is disposed after a normal completion is now contained as `abandon()` already did (#4029): it is reported as `{ kind: "render", handling: "failed" }` instead of escaping as an unhandled rejection.
