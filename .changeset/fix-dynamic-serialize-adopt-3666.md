---
"@solidjs/web": patch
"@solidjs/signals": patch
"solid-js": patch
---

fix(web): an async `dynamic()` instance serializes its landing and the client adopts it (#3666)

`dynamic()` no longer opts its memo out of hydration serialization. The per-instance value memo is an ordinary async memo: when the source introduced async (returned a thenable during SSR) its landing is serialized under the instance's id and the client memo adopts the record during hydration instead of re-running the source and waiting on it — the pending beat that committed the enclosing `<Loading>` to a fallback the server never rendered, then missed the SSR'd nodes. A server component lands as a flight reference (`_$SC.r(id, address)` now resolves to the call's binding, so a wrapped `query()` or `async` arrow around a server reference hydrates the same as a direct call), a tag name as its string, and a sync source lands nothing — unchanged.

A source that resolves to a client component _function_ cannot serialize and is now refused on the server at the point the memo would serialize it — new diagnostic `DYNAMIC_ASYNC_COMPONENT` (recorded on the observe channel; the memo rejects into the nearest `<Errored>` / `onError` in every tier). Move the async upstream (`createAsync`/`createMemo` read synchronously by the source) or use `lazy()`.

Wire shape: each async `dynamic()` instance now writes one hydration record, and every `dynamic()` instance allocates one more hydration owner id (keys under a `dynamic()` element shift by one slot).
