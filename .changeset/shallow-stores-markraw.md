---
"@solidjs/signals": patch
---

New: shallow stores.

`createStore(value, { shallow: true })` creates a single-layer store: the root's own keys are fully reactive (per-key nodes, membership, `$TRACK`, length) while its values are raw records replaced by reference — no proxies, no tracking, and no deep diffing below the boundary. `reconcile` at a shallow boundary is a positional per-slot reference compare; keyed row identity belongs to the consumer (`<For keyed={r => r.id}>`). Records are replaced, never edited in place: setter reads below the boundary serve the raw (so read-then-replace and `filter`/`pop` idioms work) and in-place mutation is reactively inert by construction — which is what makes optimistic staging sound: replacements stage in the existing override layers and ambient writes auto-revert to the untouched raw base. The option is available on `createProjection`/`createOptimisticStore` via their options.

Records ingested below a shallow boundary are sticky-marked raw in an internal registry: no store ever wraps them — they present as-is everywhere, tracked by reference at whatever slot holds them, so a record served raw once keeps a single identity in every store (no proxy/raw split-brain). The registry is consulted only on wrap-creation and ingest paths behind a used-at-all gate; reads and shallow-free apps are untouched. (A public `markRaw` for external instances/proxy props is deliberately deferred.)

Hardened against an adversarial audit: raw-marked values are leaves in every reconcile recursion path (previously a raw pair silently no-op'd instead of replacing the slot — affecting deep stores holding `markRaw` values, setter-write-then-reconcile on shallow stores, and shallow stores nested in deep ones); setter-staged overrides fold into the shallow diff; write-scope reads serve the raw so read-then-replace, `filter`/`pop` removal idioms, and projection derives work; ingesting an already-deep-tracked value into a shallow boundary throws in dev; `deep()` no longer wraps below raw values. Exposed end to end: plain-form `createStore`/`createOptimisticStore` accept options, `ProjectionOptions.shallow` typed.

Measured on the dbmon-shaped workload (1000 rows × 13 bindings, fresh keyed payload per tick): reconcile 14× faster (3.2 → 0.22ms), full reactive tick 2.4× faster; on the octane dbmon browser harness with all keyed lifecycle gates passing, the store fixture goes from 2.6× to 1.7× octane (1.36× with `textContent` bindings), ahead of React on every op. +1.4KB gzip.
