---
"@solidjs/signals": patch
"solid-js": patch
---

Add `until(fn, options?)` — the acknowledgment primitive for mutations confirmed on a live data channel (sockets, subscriptions, live queries) rather than by the mutation's own response. Resolves the first time the reactive predicate settles truthy (falsy and pending both mean "not yet"); `yield until(...)` from an action holds the transaction — and its optimistic state — open until the world confirms, with `{ timeout }` (`TimeoutError`) and `{ signal }` rejections throwing back at the yield point so failed holds revert like any failed action.

The predicate reads the AUTHORITATIVE view, and the carve-out is exactly one layer deep: the caller's own optimistic overrides (values and structure) are invisible, so a tentative write can never satisfy its own ack — including on the single-primitive shape where the optimistic store is the live-fed store. Everything else reads normally, including uncommitted transition-staged data: truth landing into the open transaction (e.g. a `refresh()` the action issued) stages and cannot commit until the hold releases, so refusing staged reads would deadlock the hold on its own data plane. The A17-silent "landing equals the override" paths wake authoritative readers only (`CONFIG_AUTHORITATIVE_OBSERVED`); the wakeup machinery is hook-installed at first `until()` call so unused apps tree-shake it.

Also fixes `resolve()` (and `until()`) delivering stale values when their source settles into a held transaction: promise-delivery effects apply on a microtask (#2930) but their computed value staged with the transition, so the immediate apply read stale mainline state — `resolve` could report pre-refresh data and `until` could deadlock. Such effects now commit their value directly (`CONFIG_DIRECT_COMMIT`), keeping value and delivery on the same schedule; safe because effects are private leaves (no subscriber reads an effect's value).
