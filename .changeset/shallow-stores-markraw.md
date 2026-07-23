---
"@solidjs/signals": patch
---

New: shallow stores and `markRaw`.

`createStore(value, { shallow: true })` creates a single-layer store: the root's own keys are fully reactive (per-key nodes, membership, `$TRACK`, length) while its values are raw records replaced by reference — no proxies, no tracking, and no deep diffing below the boundary. `reconcile` at a shallow boundary is a positional per-slot reference compare; keyed row identity belongs to the consumer (`<For keyed={r => r.id}>`). Mutating below the boundary through a setter throws — records are replaced, never edited in place — which is what makes optimistic staging sound: replacements stage in the existing override layers and ambient writes auto-revert to the untouched raw base. The option is available on `createProjection`/`createOptimisticStore` via their options.

`markRaw(value)` marks a value as permanently raw: no store ever wraps it — it presents as-is everywhere, tracked by reference at whatever slot holds it (class instances, external library objects, record-shaped data). Shallow stores sticky-mark ingested values with the same registry, so a record served raw once stays raw in every store (single identity, no proxy/raw split-brain). The registry is consulted only on wrap-creation and ingest paths; reads are untouched.

Measured on the dbmon-shaped workload (1000 rows × 13 bindings, fresh keyed payload per tick): reconcile 14× faster (3.2 → 0.22ms), full reactive tick 2.4× faster; on the octane dbmon browser harness with all keyed lifecycle gates passing, the store fixture goes from 2.6× to 1.7× octane (1.36× with `textContent` bindings), ahead of React on every op. +1.4KB gzip.
