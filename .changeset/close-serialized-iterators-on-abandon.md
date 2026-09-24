---
"solid-js": patch
---

Close a serialized async iterator once the response that carries it is abandoned. When a `renderToStream` consumer cancels the readable or a `pipe` sink throws, the render is disposed, but the tapped iterator handed to the serializer kept delegating `next()` to the source, so an iterable memo, an async memo that resolves to an iterable, and a generator projection kept pulling (or never ran their `finally`) for as long as the source lived. The tapped iterator now answers `done` and calls the source's `return()` once its computation is disposed, and the projection pump closes its source when it stops for disposal.
