---
"solid-js": patch
---

Bare `ssrSource: "client"` (no `loadingValue`/`seedLoadingValue`) is now the structural form instead of a dev error: on the server the source is a final hole — reads suspend the nearest `<Loading>` boundary, which flushes its fallback with the client-continue marker (or rejects its stream fragment when the hole surfaces after registration) and hands the position to the client, which renders the content fresh after hydration. Read outside a `<Loading>` boundary it throws a real error instead of hanging the stream. The declared form is unchanged: `loadingValue`/`seedLoadingValue` renders the declared first paint on the server and stays the value-channel alternative. Also swallows the settled-rejected fragment promise at the hydration claim so rejected fragments (error finalize or client handoff) no longer surface unhandled-rejection noise.
