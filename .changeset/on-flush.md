---
"@solidjs/signals": patch
"solid-js": patch
---

Add `onFlush(fn)`: runs `fn` once right after the pending flush, before paint, without waiting on async work. A write made there is its own update, so it is not held by async work another write in the same frame started (a menu closing while the consumer's `onSelect` navigates). Meant for event handlers and effect callbacks; dev warns (`ON_FLUSH_IN_OWNED_SCOPE`) in a component body or computation. Tree-shakes when unused.
