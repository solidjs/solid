---
"solid-js": patch
---

Fix hydration adoption trace pulling an async iterable the compute did not construct. The trace-run (`subFetch`) primed async-generator computes by pulling their first step under mocked `fetch`/`Promise`; it now does so only when the returned value is its own iterator (a generator object), leaving live-call iterables and deserialized codec streams untouched. Pulling a foreign adapter minted its resolver through the mocked `Promise`, corrupting its queue — the next streamed value threw `temp.s is not a function` from the document's inline runtime. Surfaces with a nested-async live answer (`{ progress: asyncIterable }`) read by a child memo during hydration, and as #3647: a foreign iterable whose `[Symbol.asyncIterator]()` is the subscription itself (the router's `liveQuery`) was opened against a `fetch` that never settles, so it never connected after hydration.
