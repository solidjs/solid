---
"solid-js": patch
---

Fix `createProjection`/`createStore(fn)` with `ssrSource: "client"` leaking their seeded draft value on the client's initial render (#2981).

A `"client"` source is gated behind a `hydrated` signal during hydration so the derive runs only after hydration completes. The gate previously returned `undefined`, which settled the projection against its seed — leaving the seed readable ("Initial Value" rendered before the async source resolved) instead of staying pending. The gate now throws `NotReady` while hydration is incomplete, so reads stay pending (the `Loading` fallback shows) exactly like `ssrSource: "server"`/`"hybrid"` sources, and the seed is never observable before first resolution (#2897).
