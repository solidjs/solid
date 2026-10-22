---
"@solidjs/web": patch
---

Add a `buildId` option to `configureServerFunctionsClient` and `configureServerFunctionsServer`. When both are set, the client sends its build's id on every call that is not GET-encoded. A server with a different id answers `409` without running the function, and the client rejects with `error.versionSkew: true`, so an integration can reload the page onto the current build. This catches skew the unknown-id 404 cannot: a function whose id survived a deploy but whose arguments or result changed shape.
