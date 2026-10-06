---
"solid-js": patch
---

Fix a nested `<Suspense>` on the server resolving with children from a render its parent `<Suspense>` had already discarded. The boundary now always completes from its latest render, and a fragment left pending by an earlier render is settled when a re-render resolves inline, so `renderToStringAsync`/`renderToStream` no longer hang or stream stale content.
