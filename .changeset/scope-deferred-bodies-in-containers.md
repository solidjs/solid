---
"@solidjs/web": patch
---

Scope a deferred body wherever it sits in a directly-called result, not only at the top level. `scopeDeferredResult` looked at the returned value itself, so `return { rows: cursor() }` from an SSR-time call ran its generator under the render's ambient event: two concurrent direct calls read and wrote each other's `locals`, and the render's own, which is the failure the per-call `locals` copy exists to prevent. The descent now covers containers, so a generator or stream one level down carries the call's own request event like a top-level one.
