---
"@solidjs/signals": patch
---

Docs: inside an `action`, a bare `yield` is required after an `await` before anything that creates a reader — `until()`, `latest()`, a memo or effect, a mount — not only before writes. The `until()` docstring's own example had `await` straight into `yield until(...)`; the `until(...)` expression is evaluated in the post-`await` continuation, outside the transaction, and its predicate reader is born held there (#3482). Example corrected.
