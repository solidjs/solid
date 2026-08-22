---
"solid-js": patch
---

Defer the server memo's async scaffolding to first async engagement. The disposal-flag cleanup closure registered eagerly on every async-path memo creation now arms only when a compute produces an async-shaped result or throws NotReady (the only cases the flag guards — stale in-flight serialization), and the rerun closure is hoisted out of update(). Async-path memo creation drops 39% (251ns to 154ns); news-page SSR throughput +8.5% end-to-end. Hydration id allocation is untouched — the deferred arming only appends to the creation owner's disposal list.
