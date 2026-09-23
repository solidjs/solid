---
"@solidjs/web": patch
---

fix(web): `hydrate()` waits for the document's records when a stylesheet delays them (#3610)

A still-loading stylesheet blocks the classic records `<script>` but not an `async` module entry, so `hydrate()` could start against the bootstrap's empty `_$HY.r`: a streamed `<Loading>` fell through to a fresh boundary (a `Hydration key miss` on its fallback, a client refetch, a `$df` swap nobody claimed). `generateHydrationScript()` — hand-built documents, where the bootstrap and the records are placed apart — now marks the bootstrap `p:1`; with that flag, mid-parse, and no record landed, `hydrate()` parks its start until the first `_$HY.r` write or `DOMContentLoaded`. `<HydrationScript />` omits the flag (its records are spliced right after it), so JSX documents and post-load hydration are unchanged. The dispose function is still returned synchronously and cancels a parked start.
