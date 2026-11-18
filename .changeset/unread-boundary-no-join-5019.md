---
"@solidjs/signals": patch
---

A held reader that stops carrying a source still in flight no longer joins that source's hold. An unread `createErrorBoundary` over memos of a list with a refresh out no longer holds an unrelated change until the refresh lands (#5019).
