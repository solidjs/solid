---
"@solidjs/web": patch
---

Each event replayed after hydration is its own instant, as it would have been live (#4285). `runHydrationEvents` now flushes after every replayed event, so a handler reads the writes of the events before it: two clicks on a counter queued before the client loaded bump it twice, not once.
