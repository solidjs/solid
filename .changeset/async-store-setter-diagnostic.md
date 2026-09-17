---
"@solidjs/signals": patch
"solid-js": patch
---

New dev diagnostic `ASYNC_STORE_SETTER`: a store setter callback that returns a Promise now throws in dev (through the diagnostics channel) instead of being silently ignored. A store setter is a synchronous transaction — the draft closes when the callback returns — so `setStore(async d => …)` committed only the writes before its first `await` and lost the rest. Covers every store family with a user setter (`createStore`, `createOptimisticStore`, the derived store's manual setter); a derived store's own async compute is not affected. Store-specific: a signal may legitimately hold a promise, so `setSignal` has no such rule. Production is unchanged.

Docs: the `OBSERVE.exclude` guidance in RFC 08 no longer suggests `runWithOwner(panelRoot, …)` for panel writes (that is a write in an owned scope, see #3512); the store's own nodes carry the excluded owner.
