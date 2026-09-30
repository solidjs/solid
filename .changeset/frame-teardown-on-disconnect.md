---
"@solidjs/web": patch
"solid-js": patch
---

Frame renders tear down when their reader is gone. `serverComponentResponse`'s body `cancel()` and the request's abort (`frameTransformResult` / `frameTransformFlightResult` pass `event.request.signal`) now dispose the render through `renderToStream`'s disconnect path — previously `cancel()` only dropped writes and the render ran on until its sources happened to end. `renderToStream` gains a `signal?: AbortSignal` option for this (the `SSR_STREAM_ABANDONED` finding reports it as `data.reason: "signal"`); `renderToFrameStream`, `renderServerComponent` and `serverComponentResponse` accept it through their options. A frame flight response stops at the frame in progress and skips the rest. In `solid-js`, the server pump over an async iterable in frame scope closes its source from the compute's disposal — `return()` now, not at the source's next yield — so a standing source (a change feed, a subscription) does not hold what it subscribed to until an event nobody would see.
