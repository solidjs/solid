---
"@solidjs/signals": patch
"solid-js": patch
"@solidjs/web": patch
---

Attribution engine: timeline records, and a `flushStart` hook

Five new listener-gated records on `attribution.subscribe`: `create` (a computation's creation run — the mount flame), `effect` (an effect callback, timed and joined to its compute run), `flush` (one scheduler drain: runs, creations, whether it parked a transition, the interaction it served), `flight` (an async flight from origin to landing or abandonment, with the async node's owner path) and `fallback` (a loading boundary's fallback from show to hide). None is built, logged or folded unless something is subscribed to its type, so the console/agent readers pay nothing for records only a timeline wants. `OBSERVE.subjectOf` answers for the node-bearing ones.

Core: a `flushStart` hook beside `flushEnd` (one drain, never nested), and `effectRunStart` now fires in observe builds like its `effectRunEnd` twin, so writes inside effect callbacks carry their `effect` origin in observe too, not only in dev. The observe core grows by 67 bytes minified; prod is byte-identical.

The engine's effect-frame → node map is now filled by the first write inside a callback rather than by every callback (every reader resolves it through a write's origin, and most effect callbacks never write), which removes a WeakMap write per effect callback from the enabled engine's hot path.

`@solidjs/web/performance-tracks` paints the new records: creation runs and effect callbacks on the `Effects`/`Memos` tracks, drains on the `Propagation` track (one wave per drain), flights and fallbacks on a new `Async` track.
