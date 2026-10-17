---
"@solidjs/diagnostics": patch
---

Captured findings carry `loc` (the source location the runtime resolved, `file:line:col`) as a plain event field through artifacts and the JSONL form; assertion failures print it with the rest of the offending event.
