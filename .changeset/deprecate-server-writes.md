---
"solid-js": patch
---

Deprecate setter writes on the server with a `[SERVER_WRITE]` warning (once per process per category: signal, store, optimistic). Server render is pure — change enters through async sources, never setters. Behavior is unchanged this release: signal and store writes still land as inert data (nothing re-renders) and optimistic writes remain no-ops, but server writes will become an error in a future release. If you are bridging a subscription, make it the async source itself instead of pushing writes from its callback.
