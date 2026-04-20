---
"solid-js": patch
---

Fix `createProjection` hydration from async iterables when no `Loading` boundary wraps the consumer (e.g. `Repeat` reading projection state directly).

- `hydration.ts`: disable snapshot capture while applying the initial full value from the server iterable so `prepareStoreWrite` doesn't record the pre-write (empty) base as the snapshot. Without this, reads during hydration (like `Repeat` reading `length`) see the stale pre-value and fail to match the server-rendered DOM, producing unclaimed nodes and duplicated items.
- `projection.ts`: eagerly assign the inner `computed` owner to the outer `node` binding on first run so `STORE_FIREWALL` lookups work during synchronous hydration writes (before `node = computed(...)` returns).
