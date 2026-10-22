---
"@solidjs/web": patch
---

`renderToStream` now completes when a value the serializer cannot handle is written already settled (a `deferStream` value, or a `getHydrationWriter().write`). The failure was already reported as `{ kind: "render", handling: "serialize" }`, but the render stayed pending: no `onCompleteAll`, no end of the piped stream, no final dispose. `createJSONSerializer` (the frames default) had the same gap and is fixed too; its `close()` now always calls `onDone` once. Without an `onError`, a write that fails still throws, and both serializers now complete on `flush()` after it. `createHydrationSerializer` (internal) returns `{ write, flush, close }` instead of seroval's `Serializer`, with the same output.
