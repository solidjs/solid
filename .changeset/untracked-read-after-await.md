---
"@solidjs/signals": patch
---

Dev: warn with `UNTRACKED_READ_AFTER_AWAIT` when an async computation first reads a signal, memo, or store property after an `await`. Such reads are not dependencies, so the computation silently keeps its old result when they change. The check uses V8 async stack traces to attribute the read to its computation, runs only in dev builds, and keeps dev settle timing identical to production.
