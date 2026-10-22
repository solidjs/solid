---
"@solidjs/web": patch
---

Add a `buildId` option to `configureServerFunctionsServer`. A call whose `X-Server-Function-Build` header names another build is answered `409` without running the function, and the client rejects with `error.unknownFunction: true`, the same as for a function the deploy removed. The build integration adds the header through `prepareRequest`, so the client runtime does not grow. This catches skew the unknown-id 404 cannot: a function whose id survived a deploy but whose arguments or result changed shape.
